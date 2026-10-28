"""
Fuel rules and analytics. One place, so the API and the Excel import can't bypass them.

Odometer sequence: a fill-up's reading must fit between the vehicle's previous and next fill-ups (by date).
The newest fill-up can move the vehicle's odometer forward, never back.

km/L is only estimated between two FULL-TANK fill-ups: distance between them divided by all liters added
after the first up to and including the second. Partial fills alone can't give a fair figure, so none is shown.
"""
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import F, Max, Min, OuterRef, Q, Subquery, Sum
from django.utils import timezone
from rest_framework import serializers

from accounts.permissions import scope_to_offices
from fleet.models import Driver, Vehicle

from .models import FuelRecord

TOTAL_TOLERANCE = Decimal('1.00')  # pesos: receipts round differently; anything bigger is a typo
UNUSUAL_RATIO = Decimal('0.75')    # km/L below 75% of the vehicle's usual figure is flagged
STRICT_FUELS = {Vehicle.Fuel.GASOLINE, Vehicle.Fuel.DIESEL}


def _fail(field, msg):
    raise serializers.ValidationError({field: [msg]})


def _money(v):
    return Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def save_record(*, user, instance=None, data):
    """Create or update a fuel record after all checks. Returns (record, vehicle_odometer_before, after)."""
    vehicle, driver = data['vehicle'], data.get('driver')
    if not scope_to_offices(Vehicle.objects.filter(pk=vehicle.pk), user, 'office').exists():
        _fail('vehicle', 'You do not have access to this vehicle.')
    if driver and not scope_to_offices(Driver.objects.filter(pk=driver.pk), user, 'office').exists():
        _fail('driver', 'You do not have access to this driver.')
    if data['date'] > timezone.localdate():
        _fail('date', 'The fill-up date cannot be in the future.')
    if data['liters'] <= 0:
        _fail('liters', 'Liters must be more than zero.')
    if data['unit_price'] <= 0:
        _fail('unit_price', 'Unit price must be more than zero.')
    if vehicle.fuel_type in STRICT_FUELS and data['fuel_type'] != vehicle.fuel_type:
        _fail('fuel_type', f'{vehicle.plate_number} uses {vehicle.get_fuel_type_display().lower()}.')

    computed = _money(data['liters'] * data['unit_price'])
    total = data.get('total_amount')
    if total is None:
        data['total_amount'] = computed
    elif abs(total - computed) > TOTAL_TOLERANCE:
        _fail('total_amount', f'Does not match liters × unit price (₱{computed:,.2f}). Check the receipt.')

    with transaction.atomic():
        vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)  # serialize odometer checks per vehicle
        others = vehicle.fuel_records.exclude(pk=instance.pk if instance else None)
        d, odo = data['date'], data['odometer']
        prev = others.filter(Q(date__lt=d) | Q(date=d, odometer__lte=odo)).order_by('-date', '-odometer').first()
        nxt = others.filter(date__gt=d).order_by('date', 'odometer').first()
        if prev and odo < prev.odometer:
            _fail('odometer', f'Lower than the previous fill-up on {prev.date:%b %d, %Y} ({prev.odometer:,} km).')
        if nxt and odo > nxt.odometer:
            _fail('odometer', f'Higher than the next fill-up on {nxt.date:%b %d, %Y} ({nxt.odometer:,} km).')

        if instance is None:
            record = FuelRecord.objects.create(created_by=user, **data)
        else:
            for k, v in data.items():
                setattr(instance, k, v)
            instance.save()
            record = instance

        before = vehicle.current_odometer
        if nxt is None and odo > vehicle.current_odometer:
            # Newest reading on record: the vehicle has been driven at least this far.
            vehicle.current_odometer = odo
            vehicle.save(update_fields=['current_odometer', 'updated_at'])
    return record, before, vehicle.current_odometer


# ---------------------------------------------------------------- analytics

def with_analytics(qs):
    """
    Annotate fuel records (any filtering) with:
      prev_odometer      previous fill-up's reading for the same vehicle  -> distance since last fill-up
      prev_full_odometer previous FULL-TANK reading                        -> km/L window start
      liters_since_full  liters added after that full tank, up to and including this record
    Subqueries look at the vehicle's whole history, so date/office filters don't distort the numbers.
    """
    same_vehicle = FuelRecord.objects.filter(vehicle=OuterRef('vehicle_id'))
    prev = same_vehicle.filter(odometer__lt=OuterRef('odometer')).order_by('-odometer')
    prev_full = prev.filter(is_full_tank=True)
    liters = (FuelRecord.objects.filter(vehicle=OuterRef('vehicle_id'), odometer__gt=OuterRef('prev_full_odometer'),
                                        odometer__lte=OuterRef('odometer'))
              .order_by().values('vehicle').annotate(total=Sum('liters')).values('total'))
    return qs.annotate(
        prev_odometer=Subquery(prev.values('odometer')[:1]),
        prev_full_odometer=Subquery(prev_full.values('odometer')[:1]),
    ).annotate(liters_since_full=Subquery(liters[:1]))


def km_per_liter(record):
    """Estimated km/L for a full-tank record, or None when there is no fair comparison."""
    if not record.is_full_tank or record.prev_full_odometer is None or not record.liters_since_full:
        return None
    km = record.odometer - record.prev_full_odometer
    return (Decimal(km) / record.liters_since_full).quantize(Decimal('0.01')) if km > 0 else None


def vehicle_average(vehicle_id):
    """Usual km/L for a vehicle: total distance between its first and last full tank over the liters in between."""
    return vehicle_averages([vehicle_id]).get(vehicle_id)


def vehicle_averages(vehicle_ids):
    """vehicle_average() for many vehicles in one query: {vehicle_id: km/L}, vehicles without a fair figure left out."""
    fulls = FuelRecord.objects.filter(vehicle=OuterRef('vehicle_id'), is_full_tank=True).order_by()
    span = lambda agg: Subquery(fulls.values('vehicle').annotate(x=agg('odometer')).values('x')[:1])
    rows = (FuelRecord.objects.filter(vehicle_id__in=set(vehicle_ids))
            .annotate(lo=span(Min), hi=span(Max))
            .filter(hi__gt=F('lo'), odometer__gt=F('lo'), odometer__lte=F('hi'))
            .values('vehicle_id', 'lo', 'hi').annotate(liters=Sum('liters')).order_by())
    return {r['vehicle_id']: (Decimal(r['hi'] - r['lo']) / r['liters']).quantize(Decimal('0.01'))
            for r in rows if r['liters']}


def is_unusual(kml, average):
    return kml is not None and average is not None and kml < average * UNUSUAL_RATIO
