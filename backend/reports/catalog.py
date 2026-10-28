"""
Phase 13 reports. Each report is a function registered with @report that turns validated filters (Ctx) into
columns, rows and totals. The same result feeds the on-screen preview, the print view and the CSV / Excel / PDF
exports, so every format shows the same figures.

Rules are shared with the rest of the app so a report matches the page it summarises:
- records are office-scoped with scope_to_offices (same as the lists), archived vehicles are left out;
- a report needs the view permission of every model it reads (columns from optional modules only appear when allowed);
- dates filter like the lists: fuel/maintenance by record date, trips by departure (or scheduled departure);
- cost totals count COMPLETED maintenance only, document reports use ACTIVE documents and fleet.documents bands.

A row is a dict keyed by column key, holding plain Python values (str, int, Decimal, date, datetime, None);
`kind` on the column tells the exporters how to format it.
"""
from dataclasses import dataclass
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from accounts.models import Office
from accounts.permissions import scope_to_offices
from fleet import documents
from fleet.models import Driver, Vehicle, VehicleAssignment, VehicleDocument
from maintenance.models import MaintenanceRecord
from operations import fuel as fuel_service
from operations.models import FuelRecord, Trip

REPORTS = {}
ZERO = Decimal('0')
VS = Vehicle.Status
MS = MaintenanceRecord.Status
LTO_TYPES = [VehicleDocument.Type.LTO_REGISTRATION]
INSURANCE_TYPES = [VehicleDocument.Type.GSIS_INSURANCE, VehicleDocument.Type.INSURANCE_POLICY]


@dataclass
class Report:
    slug: str
    title: str
    group: str
    description: str
    perms: tuple
    filters: tuple            # office, vehicle, driver, status, category, group_by, period
    build: object
    statuses: object = ()     # (value, label) choices for the status filter, or a function returning them
    group_by: tuple = ()      # (value, label); first is the default
    required: tuple = ()      # filters that must be given
    default_period: bool = True  # no dates given -> this month to date
    period_label: str = 'Date'


def report(slug, title, group, description, perms, filters, **extra):
    def wrap(fn):
        REPORTS[slug] = Report(slug, title, group, description, tuple(perms), tuple(filters), fn, **extra)
        return fn
    return wrap


def col(key, label, kind='text'):
    """kind: text, int, km, money, qty, num, pct, date, datetime."""
    return {'key': key, 'label': label, 'kind': kind}


def result(columns, rows, totals=None, summary=(), notes=()):
    return {'columns': columns, 'rows': rows, 'totals': totals or {}, 'summary': list(summary), 'notes': list(notes)}


class Ctx:
    """Validated filters (office/vehicle/driver are model instances) plus the scoping helpers reports share."""
    def __init__(self, user, today, **params):
        self.user, self.today = user, today
        for k in ('office', 'vehicle', 'driver', 'status', 'category', 'group_by', 'date_from', 'date_to'):
            setattr(self, k, params.get(k))

    def can(self, perm):
        return self.user.has_perm(perm)

    def scope(self, qs, office_field='vehicle__office', vehicle_field='vehicle', driver_field=None):
        qs = scope_to_offices(qs, self.user, office_field)
        if self.office:
            qs = qs.filter(**{office_field: self.office})
        if self.vehicle and vehicle_field:  # by id, so a field path of 'pk' works as well as 'vehicle'
            qs = qs.filter(**{vehicle_field: self.vehicle.pk})
        if self.driver and driver_field:
            qs = qs.filter(**{driver_field: self.driver.pk})
        return qs

    def dates(self, qs, field):
        if self.date_from:
            qs = qs.filter(**{f'{field}__gte': self.date_from})
        if self.date_to:
            qs = qs.filter(**{f'{field}__lte': self.date_to})
        return qs

    def vehicles(self):
        return self.scope(Vehicle.objects.filter(is_archived=False).select_related('office'), 'office', 'pk')

    def trips(self, qs):
        """Trips in the period by departure, or scheduled departure for trips that haven't left (as the trip list)."""
        return self.dates(qs.alias(_when=Coalesce('departed_at', 'scheduled_departure')), '_when__date')

    @property
    def period_days(self):
        return (self.date_to - self.date_from).days + 1


def dec(v):
    return Decimal(str(v or 0))


def vehicle_name(v):
    return ' '.join(x for x in (v.make, v.model, v.variant) if x)


def sum_of(rows, *keys):
    return {k: sum(r[k] or 0 for r in rows) for k in keys}


def ratio(a, b, places='0.01'):
    return (dec(a) / dec(b)).quantize(Decimal(places)) if b else None


def pct(a, b):
    return (dec(a) * 100 / dec(b)).quantize(Decimal('0.1')) if b else None


def band_label(band):
    return {'EXPIRED': 'Expired', 'VALID': 'Valid', 'NONE': 'No expiry date'}.get(band) or f'Due within {band} days'


def by_status_summary(qs, choices, field='status'):
    counts = dict(qs.order_by().values_list(field).annotate(n=Count('pk')))
    return [{'label': label, 'value': counts.get(value, 0)} for value, label in choices]


# ---------------------------------------------------------------- fleet

@report('vehicle-master-list', 'Vehicle Master List', 'Fleet',
        'Every vehicle with its identifiers, office, status and current assignment.',
        ['fleet.view_vehicle'], ['office', 'status'], statuses=tuple(VS.choices), default_period=False)
def vehicle_master_list(ctx):
    qs = ctx.vehicles()
    if ctx.status:
        qs = qs.filter(status=ctx.status)
    columns = [col('plate_number', 'Plate no.'), col('property_number', 'Property no.'), col('vehicle', 'Make / model'),
               col('year_model', 'Year', 'text'), col('vehicle_type', 'Type'), col('fuel_type', 'Fuel'), col('color', 'Color'),
               col('engine_number', 'Engine no.'), col('chassis_number', 'Chassis no.'), col('office', 'Office'),
               col('status', 'Status'), col('current_odometer', 'Odometer', 'km'), col('acquisition_date', 'Acquired', 'date'),
               col('acquisition_cost', 'Acquisition cost', 'money')]
    current = {}
    if ctx.can('fleet.view_vehicleassignment'):
        columns += [col('accountable_person', 'Accountable person'), col('driver', 'Assigned driver')]
        current = {a.vehicle_id: a for a in VehicleAssignment.objects.filter(end_date__isnull=True, vehicle__in=qs)}
    rows = []
    for v in qs:
        a = current.get(v.pk)
        rows.append({'plate_number': v.plate_number, 'property_number': v.property_number, 'vehicle': vehicle_name(v),
                     'year_model': str(v.year_model or ''), 'vehicle_type': v.get_vehicle_type_display(),
                     'fuel_type': v.get_fuel_type_display(), 'color': v.color, 'engine_number': v.engine_number,
                     'chassis_number': v.chassis_number, 'office': v.office.code, 'status': v.get_status_display(),
                     'current_odometer': v.current_odometer, 'acquisition_date': v.acquisition_date,
                     'acquisition_cost': v.acquisition_cost, 'accountable_person': a.accountable_person if a else '',
                     'driver': a.driver_name if a else ''})
    return result(columns, rows, {'acquisition_cost': sum((r['acquisition_cost'] or ZERO for r in rows), ZERO)},
                  summary=[{'label': 'Vehicles', 'value': len(rows)}])


@report('vehicle-status', 'Serviceable / Unserviceable Vehicles', 'Fleet',
        'Vehicles grouped by condition, with counts per status.',
        ['fleet.view_vehicle'], ['office', 'status'], statuses=tuple(VS.choices), default_period=False)
def vehicle_status(ctx):
    qs = ctx.vehicles()
    summary = by_status_summary(qs, VS.choices)
    if ctx.status:
        qs = qs.filter(status=ctx.status)
    order = {s: i for i, s in enumerate(VS.values)}
    rows = [{'status': v.get_status_display(), 'plate_number': v.plate_number, 'vehicle': vehicle_name(v),
             'vehicle_type': v.get_vehicle_type_display(), 'office': v.office.code, 'current_odometer': v.current_odometer,
             'remarks': v.remarks, '_order': order[v.status]} for v in qs]
    rows.sort(key=lambda r: (r.pop('_order'), r['plate_number']))
    operable = sum(s['value'] for s, (k, _) in zip(summary, VS.choices) if k in (VS.SERVICEABLE, VS.IN_USE))
    return result([col('status', 'Status'), col('plate_number', 'Plate no.'), col('vehicle', 'Make / model'),
                   col('vehicle_type', 'Type'), col('office', 'Office'), col('current_odometer', 'Odometer', 'km'),
                   col('remarks', 'Remarks')], rows,
                  summary=[*summary, {'label': 'Serviceable + in use', 'value': operable}])


@report('office-fleet-summary', 'Office Fleet Summary', 'Fleet',
        'Per office: vehicles by status, active drivers, and fuel, maintenance and trips for the period.',
        ['fleet.view_vehicle', 'accounts.view_office'], ['office', 'period'])
def office_fleet_summary(ctx):
    offices = scope_to_offices(Office.objects.filter(is_active=True), ctx.user, 'pk')
    if ctx.office:
        offices = offices.filter(pk=ctx.office.pk)
    by_office = lambda qs, field, **agg: {r[field]: r for r in qs.order_by().values(field).annotate(**agg)}
    vehicles = by_office(ctx.vehicles(), 'office', total=Count('id'),
                         **{s.lower(): Count('id', filter=Q(status=s)) for s in VS.values})
    columns = [col('code', 'Office'), col('name', 'Name'), col('total', 'Vehicles', 'int'),
               *[col(s.lower(), label, 'int') for s, label in VS.choices]]
    extra = []
    if ctx.can('fleet.view_driver'):
        drivers = by_office(ctx.scope(Driver.objects.filter(is_active=True), 'office', None), 'office', n=Count('id'))
        columns.append(col('drivers', 'Active drivers', 'int'))
        extra.append(('drivers', lambda o: drivers.get(o, {}).get('n', 0)))
    if ctx.can('operations.view_trip'):
        done = ctx.dates(ctx.scope(Trip.objects.filter(status=Trip.Status.COMPLETED)), 'departed_at__date')
        trips = by_office(done, 'vehicle__office', n=Count('id'), km=Sum('distance_km'))
        columns += [col('trips', 'Trips', 'int'), col('distance_km', 'Distance', 'km')]
        extra += [('trips', lambda o: trips.get(o, {}).get('n', 0)), ('distance_km', lambda o: trips.get(o, {}).get('km') or 0)]
    if ctx.can('operations.view_fuelrecord'):
        fuel = by_office(ctx.dates(ctx.scope(FuelRecord.objects.all()), 'date'), 'vehicle__office', amt=Sum('total_amount'))
        columns.append(col('fuel_cost', 'Fuel cost', 'money'))
        extra.append(('fuel_cost', lambda o: dec(fuel.get(o, {}).get('amt'))))
    if ctx.can('maintenance.view_maintenancerecord'):
        done = ctx.dates(ctx.scope(MaintenanceRecord.objects.filter(status=MS.COMPLETED)), 'date')
        maint = by_office(done, 'vehicle__office', labor=Sum('labor_cost'), parts=Sum('parts_cost'))
        columns.append(col('maintenance_cost', 'Maintenance cost', 'money'))
        extra.append(('maintenance_cost', lambda o: dec(maint.get(o, {}).get('labor')) + dec(maint.get(o, {}).get('parts'))))
    rows = []
    for o in offices:
        v = vehicles.get(o.pk, {})
        row = {'code': o.code, 'name': o.name, 'total': v.get('total', 0), **{s.lower(): v.get(s.lower(), 0) for s in VS.values}}
        row.update({k: fn(o.pk) for k, fn in extra})
        rows.append(row)
    numeric = [c['key'] for c in columns if c['kind'] != 'text']
    return result(columns, rows, sum_of(rows, *numeric))


@report('vehicle-history', 'Vehicle Profile / History', 'Fleet',
        'One vehicle\'s assignments, documents, trips, fuel and maintenance in date order.',
        ['fleet.view_vehicle'], ['vehicle', 'period'], required=('vehicle',), default_period=False)
def vehicle_history(ctx):
    v = ctx.vehicle
    rows = []
    add = lambda when, kind, details, odometer=None, distance=None, liters=None, amount=None: rows.append(
        {'date': when, 'kind': kind, 'details': details, 'odometer': odometer, 'distance_km': distance,
         'liters': liters, 'amount': amount})
    if ctx.can('fleet.view_vehicleassignment'):
        for a in v.assignments.select_related('office'):
            who = a.accountable_person + (f', driver {a.driver_name}' if a.driver_name else '')
            add(a.start_date, 'Assignment', f'Assigned to {a.office.code}: {who}')
            if a.end_date:
                add(a.end_date, 'Assignment ended', f'{a.office.code}: {who}')
    if ctx.can('fleet.view_vehicledocument'):
        for d in v.documents.all():
            expiry = f', expires {d.expiry_date:%Y-%m-%d}' if d.expiry_date else ''
            ref = f' {d.reference_number}' if d.reference_number else ''
            add(d.issue_date or timezone.localdate(d.created_at), 'Document',
                f'{d.get_document_type_display()}{ref}{expiry} ({d.get_status_display()})')
    if ctx.can('operations.view_trip'):
        for t in v.trips.all():
            when = t.departed_at or t.scheduled_departure
            add(timezone.localdate(when) if when else timezone.localdate(t.created_at), 'Trip',
                f'{t.ticket_number}: {t.origin} to {t.destination} ({t.get_status_display()})', t.odometer_start, t.distance_km)
    if ctx.can('operations.view_fuelrecord'):
        for f in v.fuel_records.all():
            po = f', PO {f.po_number}' if f.po_number else ''
            add(f.date, 'Fuel', f'{f.liters} L {f.get_fuel_type_display()}{" at " + f.supplier if f.supplier else ""}{po}',
                f.odometer, liters=f.liters, amount=f.total_amount)
    if ctx.can('maintenance.view_maintenancerecord'):
        for m in v.maintenance_records.prefetch_related('categories'):
            cats = ', '.join(c.name for c in m.categories.all())
            add(m.date, 'Maintenance', f'{cats + ": " if cats else ""}{m.description} ({m.get_status_display()})', m.odometer,
                amount=m.total_cost if m.status == MS.COMPLETED else None)
    rows = [r for r in rows if (not ctx.date_from or r['date'] >= ctx.date_from) and (not ctx.date_to or r['date'] <= ctx.date_to)]
    rows.sort(key=lambda r: r['date'])
    totals = {'distance_km': sum(r['distance_km'] or 0 for r in rows),
              'liters': sum((r['liters'] or ZERO for r in rows), ZERO), 'amount': sum((r['amount'] or ZERO for r in rows), ZERO)}
    return result([col('date', 'Date', 'date'), col('kind', 'Event'), col('details', 'Details'), col('odometer', 'Odometer', 'km'),
                   col('distance_km', 'Distance', 'km'), col('liters', 'Liters', 'qty'), col('amount', 'Amount', 'money')],
                  rows, totals,
                  summary=[{'label': 'Plate no.', 'value': v.plate_number}, {'label': 'Vehicle', 'value': vehicle_name(v)},
                           {'label': 'Office', 'value': v.office.code}, {'label': 'Status', 'value': v.get_status_display()},
                           {'label': 'Odometer', 'value': f'{v.current_odometer:,} km'}],
                  notes=['Amounts are fuel purchases plus completed maintenance.'])


@report('assignment-history', 'Vehicle Assignment History', 'Fleet',
        'Every assignment (current and ended) with accountable person, driver and dates.',
        ['fleet.view_vehicle', 'fleet.view_vehicleassignment'], ['office', 'vehicle', 'driver', 'status', 'period'],
        statuses=(('CURRENT', 'Current'), ('ENDED', 'Ended')), default_period=False, period_label='Active between')
def assignment_history(ctx):
    qs = ctx.scope(VehicleAssignment.objects.select_related('vehicle', 'office'), 'vehicle__office', 'vehicle', 'driver')
    if ctx.date_to:
        qs = qs.filter(start_date__lte=ctx.date_to)
    if ctx.date_from:
        qs = qs.filter(Q(end_date__isnull=True) | Q(end_date__gte=ctx.date_from))
    if ctx.status:
        qs = qs.filter(end_date__isnull=ctx.status == 'CURRENT')
    rows = [{'plate_number': a.vehicle.plate_number, 'office': a.office.code, 'accountable_person': a.accountable_person,
             'driver': a.driver_name, 'start_date': a.start_date, 'end_date': a.end_date,
             'days': ((a.end_date or ctx.today) - a.start_date).days + 1, 'status': 'Ended' if a.end_date else 'Current',
             'remarks': a.remarks} for a in qs.order_by('vehicle__plate_number', '-start_date')]
    return result([col('plate_number', 'Plate no.'), col('office', 'Office'), col('accountable_person', 'Accountable person'),
                   col('driver', 'Driver'), col('start_date', 'Start', 'date'), col('end_date', 'End', 'date'),
                   col('days', 'Days', 'int'), col('status', 'Status'), col('remarks', 'Remarks')], rows,
                  summary=[{'label': 'Assignments', 'value': len(rows)},
                           {'label': 'Current', 'value': sum(r['status'] == 'Current' for r in rows)}],
                  notes=['Days run to today for current assignments.'])


# ---------------------------------------------------------------- drivers

LICENSE_STATUSES = (('EXPIRED', 'Expired'), ('EXPIRING', 'Expiring'), ('VALID', 'Valid'))


@report('driver-assignment', 'Driver Assignment', 'Drivers',
        'Each driver\'s current vehicle, plus assignments and completed trips in the period.',
        ['fleet.view_driver', 'fleet.view_vehicleassignment'], ['office', 'driver', 'status', 'period'],
        statuses=(('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')))
def driver_assignment(ctx):
    qs = ctx.scope(Driver.objects.select_related('office'), 'office', None, 'pk')
    if ctx.status:
        qs = qs.filter(is_active=ctx.status == 'ACTIVE')
    current = {a.driver_id: a for a in VehicleAssignment.objects.filter(end_date__isnull=True, driver__in=qs).select_related('vehicle')}
    overlap = (VehicleAssignment.objects.filter(driver__in=qs, start_date__lte=ctx.date_to)
               .filter(Q(end_date__isnull=True) | Q(end_date__gte=ctx.date_from)))
    assigned = dict(overlap.order_by().values_list('driver').annotate(n=Count('id')))
    columns = [col('full_name', 'Driver'), col('employee_number', 'Employee no.'), col('office', 'Office'),
               col('license_number', 'License no.'), col('vehicle', 'Current vehicle'), col('since', 'Since', 'date'),
               col('assignments', 'Assignments in period', 'int')]
    trips = {}
    if ctx.can('operations.view_trip'):
        done = ctx.dates(Trip.objects.filter(status=Trip.Status.COMPLETED, driver__in=qs), 'departed_at__date')
        trips = {r['driver']: r for r in done.order_by().values('driver').annotate(n=Count('id'), km=Sum('distance_km'))}
        columns += [col('trips', 'Trips', 'int'), col('distance_km', 'Distance', 'km')]
    rows = []
    for d in qs:
        a = current.get(d.pk)
        rows.append({'full_name': d.full_name, 'employee_number': d.employee_number, 'office': d.office.code,
                     'license_number': d.license_number, 'vehicle': a.vehicle.plate_number if a else '',
                     'since': a.start_date if a else None, 'assignments': assigned.get(d.pk, 0),
                     'trips': trips.get(d.pk, {}).get('n', 0), 'distance_km': trips.get(d.pk, {}).get('km') or 0})
    keys = [c['key'] for c in columns if c['kind'] != 'text' and c['kind'] != 'date']
    return result(columns, rows, sum_of(rows, *keys), summary=[{'label': 'Drivers', 'value': len(rows)},
                  {'label': 'With a current vehicle', 'value': sum(bool(r['vehicle']) for r in rows)}])


@report('driver-license-expiration', 'Driver License Expiration', 'Drivers',
        'Active drivers\' license expiry dates with days left (expiring = within 60 days).',
        ['fleet.view_driver'], ['office', 'driver', 'status'],
        statuses=LICENSE_STATUSES, default_period=False)
def driver_license_expiration(ctx):
    qs = ctx.scope(Driver.objects.filter(is_active=True).select_related('office'), 'office', None, 'pk').order_by('license_expiry_date')
    labels = dict(LICENSE_STATUSES)
    rows, counts = [], {k: 0 for k in labels}
    for d in qs:
        st = d.license_status(ctx.today)
        counts[st] += 1
        if ctx.status and st != ctx.status:
            continue
        rows.append({'full_name': d.full_name, 'employee_number': d.employee_number, 'office': d.office.code,
                     'license_number': d.license_number, 'license_type': d.get_license_type_display(),
                     'restrictions': d.license_restrictions, 'expiry': d.license_expiry_date,
                     'days_left': (d.license_expiry_date - ctx.today).days, 'status': labels[st]})
    return result([col('full_name', 'Driver'), col('employee_number', 'Employee no.'), col('office', 'Office'),
                   col('license_number', 'License no.'), col('license_type', 'Type'), col('restrictions', 'Restrictions'),
                   col('expiry', 'Expires', 'date'), col('days_left', 'Days left', 'int'), col('status', 'Status')], rows,
                  summary=[{'label': labels[k], 'value': n} for k, n in counts.items()])



# ---------------------------------------------------------------- documents

def _expiration(ctx, types):
    qs = ctx.scope(VehicleDocument.objects.filter(status=VehicleDocument.Status.ACTIVE, document_type__in=types,
                                                  vehicle__is_archived=False).select_related('vehicle', 'vehicle__office'))
    qs = ctx.dates(qs, 'expiry_date')
    summary = {b: 0 for b in documents.bands()}
    rows = []
    for d in qs.order_by(Coalesce('expiry_date', 'issue_date').asc(nulls_last=True), 'vehicle__plate_number'):
        st = documents.expiry_state(d.expiry_date, ctx.today)
        summary[st['band']] += 1
        if ctx.status and st['band'] != ctx.status:
            continue
        rows.append({'plate_number': d.vehicle.plate_number, 'vehicle': vehicle_name(d.vehicle), 'office': d.vehicle.office.code,
                     'document_type': d.get_document_type_display(), 'reference_number': d.reference_number,
                     'issue_date': d.issue_date, 'expiry_date': d.expiry_date, 'days_left': st['days_left'],
                     'status': band_label(st['band'])})
    return result([col('plate_number', 'Plate no.'), col('vehicle', 'Make / model'), col('office', 'Office'),
                   col('document_type', 'Document'), col('reference_number', 'Reference no.'), col('issue_date', 'Issued', 'date'),
                   col('expiry_date', 'Expires', 'date'), col('days_left', 'Days left', 'int'), col('status', 'Renewal status')],
                  rows, summary=[{'label': band_label(b), 'value': n} for b, n in summary.items() if n or b in ('EXPIRED', 'VALID')],
                  notes=[f'Alert bands: {", ".join(str(d) for d in documents.thresholds())} days. Active documents only.'])


def _band_choices():
    return tuple((b, band_label(b)) for b in documents.bands())


@report('lto-expiration', 'LTO Registration Renewal / Expiration', 'Documents',
        'Active LTO registrations by expiry date, with days left and renewal band.',
        ['fleet.view_vehicledocument'], ['office', 'vehicle', 'status', 'period'],
        statuses=_band_choices, default_period=False, period_label='Expiry date')
def lto_expiration(ctx):
    return _expiration(ctx, LTO_TYPES)


@report('insurance-expiration', 'GSIS / Insurance Expiration', 'Documents',
        'Active GSIS insurance and insurance policies by expiry date, with days left and renewal band.',
        ['fleet.view_vehicledocument'], ['office', 'vehicle', 'status', 'period'],
        statuses=_band_choices, default_period=False, period_label='Expiry date')
def insurance_expiration(ctx):
    return _expiration(ctx, INSURANCE_TYPES)


# ---------------------------------------------------------------- fuel

def _fuel(ctx):
    return ctx.dates(ctx.scope(FuelRecord.objects.select_related('vehicle', 'vehicle__office', 'driver'), driver_field='driver'), 'date')


@report('fuel-consumption', 'Fuel Consumption', 'Fuel',
        'Liters, cost and distance per vehicle, with an estimated km/L from full-tank fill-ups.',
        ['operations.view_fuelrecord'], ['office', 'vehicle', 'period'])
def fuel_consumption(ctx):
    groups = {}
    for r in fuel_service.with_analytics(_fuel(ctx)).order_by('vehicle__plate_number', 'odometer'):
        g = groups.setdefault(r.vehicle_id, {'plate_number': r.vehicle.plate_number, 'vehicle': vehicle_name(r.vehicle),
                                             'office': r.vehicle.office.code, 'fill_ups': 0, 'liters': ZERO, 'amount': ZERO,
                                             'distance_km': 0, 'window_km': 0, 'window_liters': ZERO})
        g['fill_ups'] += 1
        g['liters'] += r.liters
        g['amount'] += r.total_amount
        if r.prev_odometer is not None:
            g['distance_km'] += r.odometer - r.prev_odometer
        if fuel_service.km_per_liter(r) is not None:  # only fair full-tank windows count towards km/L
            g['window_km'] += r.odometer - r.prev_full_odometer
            g['window_liters'] += r.liters_since_full
    rows = list(groups.values())
    for g in rows:
        g['km_per_liter'] = ratio(g['window_km'], g['window_liters'])
        g['price_per_liter'] = ratio(g['amount'], g['liters'])
    totals = sum_of(rows, 'fill_ups', 'liters', 'amount', 'distance_km', 'window_km', 'window_liters')
    totals['km_per_liter'] = ratio(totals.pop('window_km'), totals.pop('window_liters'))
    totals['price_per_liter'] = ratio(totals['amount'], totals['liters'])
    for g in rows:
        del g['window_km'], g['window_liters']
    return result([col('plate_number', 'Plate no.'), col('vehicle', 'Make / model'), col('office', 'Office'),
                   col('fill_ups', 'Fill-ups', 'int'), col('liters', 'Liters', 'qty'), col('amount', 'Amount', 'money'),
                   col('price_per_liter', 'Avg price / L', 'money'), col('distance_km', 'Distance', 'km'),
                   col('km_per_liter', 'Est. km/L', 'num')], rows, totals,
                  notes=['Distance is the odometer change since each previous fill-up.',
                         'Est. km/L uses full-tank fill-ups only (distance between full tanks over the liters added); '
                         'blank when there is no comparable pair.'])


@report('fuel-po', 'Fuel Purchase Order Log', 'Fuel',
        'Fuel records with a PO number: date, vehicle, liters, odometer, driver, supplier and amount.',
        ['operations.view_fuelrecord'], ['office', 'vehicle', 'driver', 'period'])
def fuel_po(ctx):
    qs = _fuel(ctx).exclude(po_number='').annotate(files=Count('attachments')).order_by('date', 'po_number')
    rows = [{'date': r.date, 'po_number': r.po_number, 'plate_number': r.vehicle.plate_number, 'fuel_type': r.get_fuel_type_display(),
             'liters': r.liters, 'unit_price': r.unit_price, 'odometer': r.odometer,
             'driver': r.driver.full_name if r.driver else '', 'supplier': r.supplier, 'amount': r.total_amount,
             'receipt_number': r.receipt_number, 'files': r.files} for r in qs]
    return result([col('date', 'Date', 'date'), col('po_number', 'PO no.'), col('plate_number', 'Plate no.'), col('fuel_type', 'Fuel'),
                   col('liters', 'Liters', 'qty'), col('unit_price', 'Price / L', 'money'), col('odometer', 'Odometer', 'km'),
                   col('driver', 'Driver'), col('supplier', 'Supplier'), col('amount', 'Amount', 'money'),
                   col('receipt_number', 'Receipt no.'), col('files', 'Attachments', 'int')], rows,
                  sum_of(rows, 'liters', 'amount'))


FUEL_GROUPS = (('office', 'Office'), ('vehicle', 'Vehicle'), ('month', 'Month'), ('fuel_type', 'Fuel type'))


@report('fuel-cost', 'Fuel Cost', 'Fuel', 'Fuel cost totals by office, vehicle, month or fuel type.',
        ['operations.view_fuelrecord'], ['office', 'vehicle', 'group_by', 'period'], group_by=FUEL_GROUPS)
def fuel_cost(ctx):
    qs = _fuel(ctx).order_by()
    key, label = {'office': 'vehicle__office__code', 'vehicle': 'vehicle__plate_number', 'month': 'month',
                  'fuel_type': 'fuel_type'}[ctx.group_by], dict(FUEL_GROUPS)[ctx.group_by]
    if ctx.group_by == 'month':
        qs = qs.annotate(month=TruncMonth('date'))
    names = dict(Vehicle.Fuel.choices)
    rows = []
    for r in qs.values(key).annotate(n=Count('id'), liters=Sum('liters'), amount=Sum('total_amount')).order_by(key):
        name = r[key]
        name = name.strftime('%Y-%m') if ctx.group_by == 'month' else names.get(name, name) if ctx.group_by == 'fuel_type' else name
        rows.append({'group': name, 'fill_ups': r['n'], 'liters': dec(r['liters']), 'amount': dec(r['amount']),
                     'price_per_liter': ratio(r['amount'], r['liters'])})
    totals = sum_of(rows, 'fill_ups', 'liters', 'amount')
    totals['price_per_liter'] = ratio(totals['amount'], totals['liters'])
    return result([col('group', label), col('fill_ups', 'Fill-ups', 'int'), col('liters', 'Liters', 'qty'),
                   col('amount', 'Amount', 'money'), col('price_per_liter', 'Avg price / L', 'money')], rows, totals)


# ---------------------------------------------------------------- maintenance

def _maintenance(ctx):
    qs = ctx.dates(ctx.scope(MaintenanceRecord.objects.select_related('vehicle', 'vehicle__office')), 'date')
    return qs.filter(categories=ctx.category).distinct() if ctx.category else qs


@report('maintenance-history', 'Maintenance History', 'Maintenance',
        'Maintenance jobs with categories, provider, status and costs.',
        ['maintenance.view_maintenancerecord'], ['office', 'vehicle', 'status', 'category', 'period'],
        statuses=tuple(MS.choices))
def maintenance_history(ctx):
    qs = _maintenance(ctx).prefetch_related('categories').order_by('date', 'id')
    if ctx.status:
        qs = qs.filter(status=ctx.status)
    rows, totals = [], {'labor_cost': ZERO, 'parts_cost': ZERO, 'total_cost': ZERO}
    for m in qs:
        rows.append({'date': m.date, 'plate_number': m.vehicle.plate_number, 'reference_number': m.reference_number,
                     'categories': ', '.join(c.name for c in m.categories.all()), 'description': m.description,
                     'service_provider': m.service_provider, 'status': m.get_status_display(), 'odometer': m.odometer,
                     'labor_cost': m.labor_cost, 'parts_cost': m.parts_cost, 'total_cost': dec(m.total_cost),
                     'completed_on': m.completed_on})
        if m.status == MS.COMPLETED:
            for k in totals:
                totals[k] += dec(rows[-1][k])
    return result([col('date', 'Date', 'date'), col('plate_number', 'Plate no.'), col('reference_number', 'PR / ref. no.'),
                   col('categories', 'Categories'), col('description', 'Description'), col('service_provider', 'Provider'),
                   col('status', 'Status'), col('odometer', 'Odometer', 'km'), col('labor_cost', 'Labor', 'money'),
                   col('parts_cost', 'Parts', 'money'), col('total_cost', 'Total', 'money'), col('completed_on', 'Completed', 'date')],
                  rows, totals, summary=[{'label': 'Jobs', 'value': len(rows)}],
                  notes=['Cost totals count completed jobs only, as on the Maintenance page.'])


MAINT_GROUPS = (('office', 'Office'), ('vehicle', 'Vehicle'), ('category', 'Category'), ('month', 'Month'))


@report('maintenance-expense', 'Maintenance Expense', 'Maintenance',
        'Completed maintenance cost by office, vehicle, category or month.',
        ['maintenance.view_maintenancerecord'], ['office', 'vehicle', 'category', 'group_by', 'period'], group_by=MAINT_GROUPS)
def maintenance_expense(ctx):
    done = _maintenance(ctx).filter(status=MS.COMPLETED).order_by()
    key, label = {'office': 'vehicle__office__code', 'vehicle': 'vehicle__plate_number', 'category': 'categories__name',
                  'month': 'month'}[ctx.group_by], dict(MAINT_GROUPS)[ctx.group_by]
    qs = MaintenanceRecord.objects.filter(pk__in=done.values('pk')).order_by()  # plain rows: the category join below counts once per category
    if ctx.group_by == 'month':
        qs = qs.annotate(month=TruncMonth('date'))
    rows = []
    for r in qs.values(key).annotate(n=Count('id'), labor=Sum('labor_cost'), parts=Sum('parts_cost')).order_by(key):
        name = r[key].strftime('%Y-%m') if ctx.group_by == 'month' else (r[key] or 'Uncategorized')
        labor, parts = dec(r['labor']), dec(r['parts'])
        rows.append({'group': name, 'jobs': r['n'], 'labor_cost': labor, 'parts_cost': parts, 'total_cost': labor + parts})
    agg = qs.aggregate(n=Count('id'), labor=Sum('labor_cost'), parts=Sum('parts_cost'))
    totals = {'jobs': agg['n'], 'labor_cost': dec(agg['labor']), 'parts_cost': dec(agg['parts'])}
    totals['total_cost'] = totals['labor_cost'] + totals['parts_cost']
    notes = ['Completed jobs only, by maintenance date.']
    if ctx.group_by == 'category':
        notes.append('A job with several categories is listed under each; the total counts it once.')
    return result([col('group', label), col('jobs', 'Jobs', 'int'), col('labor_cost', 'Labor', 'money'),
                   col('parts_cost', 'Parts', 'money'), col('total_cost', 'Total', 'money')], rows, totals, notes=notes)


# ---------------------------------------------------------------- trips

@report('trip-history', 'Trip History', 'Trips',
        'Trip tickets with route, driver, status, odometer readings and distance.',
        ['operations.view_trip'], ['office', 'vehicle', 'driver', 'status', 'period'], statuses=tuple(Trip.Status.choices))
def trip_history(ctx):
    qs = ctx.trips(ctx.scope(Trip.objects.select_related('vehicle', 'driver', 'requesting_office'), driver_field='driver'))
    if ctx.status:
        qs = qs.filter(status=ctx.status)
    local = lambda dt: timezone.localtime(dt) if dt else None
    rows = [{'ticket_number': t.ticket_number, 'departure': local(t.departed_at or t.scheduled_departure),
             'returned': local(t.returned_at), 'plate_number': t.vehicle.plate_number, 'driver': t.driver.full_name,
             'requesting_office': t.requesting_office.code if t.requesting_office else '', 'origin': t.origin,
             'destination': t.destination, 'purpose': t.purpose, 'status': t.get_status_display(),
             'odometer_start': t.odometer_start, 'odometer_end': t.odometer_end, 'distance_km': t.distance_km}
            for t in qs.order_by(Coalesce('departed_at', 'scheduled_departure').asc(), 'id')]
    return result([col('ticket_number', 'Ticket no.'), col('departure', 'Departure', 'datetime'), col('returned', 'Returned', 'datetime'),
                   col('plate_number', 'Plate no.'), col('driver', 'Driver'), col('requesting_office', 'Requested by'),
                   col('origin', 'Origin'), col('destination', 'Destination'), col('purpose', 'Purpose'), col('status', 'Status'),
                   col('odometer_start', 'Odo. start', 'km'), col('odometer_end', 'Odo. end', 'km'), col('distance_km', 'Distance', 'km')],
                  rows, {'distance_km': sum(r['distance_km'] or 0 for r in rows)},
                  summary=by_status_summary(qs, Trip.Status.choices),
                  notes=['Scheduled trips show their planned departure. Distance is filled when a trip is completed.'])


@report('vehicle-utilization', 'Vehicle Utilization', 'Trips',
        'Completed trips, distance and days used per vehicle, as a share of the days in the period.',
        ['fleet.view_vehicle', 'operations.view_trip'], ['office', 'vehicle', 'period'])
def vehicle_utilization(ctx):
    vehicles = ctx.vehicles().exclude(status=VS.DISPOSED)
    done = ctx.dates(Trip.objects.filter(status=Trip.Status.COMPLETED, vehicle__in=vehicles), 'departed_at__date')
    stats = {}
    for vid, departed, km in done.values_list('vehicle', 'departed_at', 'distance_km'):
        s = stats.setdefault(vid, {'trips': 0, 'km': 0, 'days': set()})
        s['trips'] += 1
        s['km'] += km or 0
        s['days'].add(timezone.localdate(departed))
    days = ctx.period_days
    rows = []
    for v in vehicles:
        s = stats.get(v.pk, {'trips': 0, 'km': 0, 'days': set()})
        rows.append({'plate_number': v.plate_number, 'vehicle': vehicle_name(v), 'office': v.office.code,
                     'status': v.get_status_display(), 'trips': s['trips'], 'distance_km': s['km'],
                     'days_used': len(s['days']), 'utilization': pct(len(s['days']), days)})
    rows.sort(key=lambda r: (-r['days_used'], -r['distance_km'], r['plate_number']))
    totals = sum_of(rows, 'trips', 'distance_km', 'days_used')
    totals['utilization'] = pct(totals['days_used'], days * len(rows))
    used = sum(1 for r in rows if r['trips'])
    return result([col('plate_number', 'Plate no.'), col('vehicle', 'Make / model'), col('office', 'Office'), col('status', 'Status'),
                   col('trips', 'Trips', 'int'), col('distance_km', 'Distance', 'km'), col('days_used', 'Days used', 'int'),
                   col('utilization', 'Utilization', 'pct')], rows, totals,
                  summary=[{'label': 'Vehicles', 'value': len(rows)}, {'label': 'Used in period', 'value': used},
                           {'label': 'Days in period', 'value': days}],
                  notes=['Utilization = days with at least one completed trip / days in the period. Disposed vehicles are left out.'])
