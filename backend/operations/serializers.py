from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from accounts.models import Office
from fleet.models import Driver, Vehicle

from . import fuel
from .models import FuelRecord, Trip

DESCRIPTIVE = ['requesting_office', 'passengers', 'origin', 'destination', 'purpose', 'remarks']


class TripSerializer(serializers.ModelSerializer):
    """Read shape for every trip endpoint; on PATCH only the descriptive fields can change.
    Vehicle, driver, times, odometers and status change only through dispatch / complete / cancel."""
    plate_number = serializers.CharField(source='vehicle.plate_number', read_only=True)
    vehicle_label = serializers.SerializerMethodField()
    office_code = serializers.CharField(source='vehicle.office.code', read_only=True)
    driver_name = serializers.CharField(source='driver.full_name', read_only=True)
    requesting_office = serializers.PrimaryKeyRelatedField(queryset=Office.objects.all(), required=False, allow_null=True)
    requesting_office_name = serializers.CharField(source='requesting_office.name', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    schedule_day = serializers.SerializerMethodField(help_text='For scheduled trips: TODAY, UPCOMING or MISSED.')

    class Meta:
        model = Trip
        fields = ['id', 'ticket_number', 'vehicle', 'plate_number', 'vehicle_label', 'office_code', 'driver',
                  'driver_name', 'requesting_office', 'requesting_office_name', 'passengers', 'origin', 'destination',
                  'purpose', 'scheduled_departure', 'scheduled_return', 'schedule_day', 'departed_at', 'returned_at',
                  'odometer_start', 'odometer_end', 'distance_km', 'status', 'status_display', 'remarks',
                  'created_at', 'updated_at']
        read_only_fields = [f for f in fields if f not in DESCRIPTIVE]

    def get_vehicle_label(self, t):
        return f'{t.vehicle.make} {t.vehicle.model}'

    def get_schedule_day(self, t):
        if t.status != Trip.Status.SCHEDULED:
            return None
        day, today = timezone.localtime(t.scheduled_departure).date(), timezone.localdate()
        return 'TODAY' if day == today else 'UPCOMING' if day > today else 'MISSED'


class DispatchSerializer(serializers.Serializer):
    ticket_number = serializers.CharField(max_length=40, required=False, allow_blank=True, default='',
                                          help_text='Leave blank to auto-number (TT-YYYY-00001).')
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    driver = serializers.PrimaryKeyRelatedField(queryset=Driver.objects.all())
    requesting_office = serializers.PrimaryKeyRelatedField(queryset=Office.objects.filter(is_active=True),
                                                           required=False, allow_null=True)
    passengers = serializers.CharField(required=False, allow_blank=True, default='')
    origin = serializers.CharField(max_length=200)
    destination = serializers.CharField(max_length=255)
    purpose = serializers.CharField()
    departed_at = serializers.DateTimeField()
    odometer_start = serializers.IntegerField(min_value=0)
    remarks = serializers.CharField(required=False, allow_blank=True, default='')


class CompleteSerializer(serializers.Serializer):
    returned_at = serializers.DateTimeField()
    odometer_end = serializers.IntegerField(min_value=0)
    remarks = serializers.CharField(required=False, allow_blank=True)


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)


class ScheduleSerializer(serializers.Serializer):
    """Book a trip ahead: no odometer and no actual departure yet."""
    ticket_number = serializers.CharField(max_length=40, required=False, allow_blank=True, default='')
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    driver = serializers.PrimaryKeyRelatedField(queryset=Driver.objects.all())
    scheduled_departure = serializers.DateTimeField()
    scheduled_return = serializers.DateTimeField(required=False, allow_null=True)
    requesting_office = serializers.PrimaryKeyRelatedField(queryset=Office.objects.filter(is_active=True),
                                                           required=False, allow_null=True)
    passengers = serializers.CharField(required=False, allow_blank=True, default='')
    origin = serializers.CharField(max_length=200)
    destination = serializers.CharField(max_length=255)
    purpose = serializers.CharField()
    remarks = serializers.CharField(required=False, allow_blank=True, default='')


class RescheduleSerializer(serializers.Serializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    driver = serializers.PrimaryKeyRelatedField(queryset=Driver.objects.all())
    scheduled_departure = serializers.DateTimeField()
    scheduled_return = serializers.DateTimeField(required=False, allow_null=True)


class DispatchScheduledSerializer(serializers.Serializer):
    odometer_start = serializers.IntegerField(min_value=0)
    departed_at = serializers.DateTimeField(required=False, help_text='Defaults to now.')


class DisplayTripSerializer(serializers.ModelSerializer):
    """Public TV fields only: no passengers, purpose, remarks, odometer or ids."""
    plate_number = serializers.CharField(source='vehicle.plate_number')
    vehicle_label = serializers.SerializerMethodField()
    driver_name = serializers.CharField(source='driver.full_name')
    office_code = serializers.CharField(source='vehicle.office.code')
    flag = serializers.SerializerMethodField(help_text='DELAYED (late to leave) or OVERDUE (late to return).')

    class Meta:
        model = Trip
        fields = ['ticket_number', 'plate_number', 'vehicle_label', 'driver_name', 'office_code', 'destination',
                  'status', 'scheduled_departure', 'scheduled_return', 'departed_at', 'returned_at', 'flag']

    def get_vehicle_label(self, t):
        return f'{t.vehicle.make} {t.vehicle.model}'

    def get_flag(self, t):
        now = timezone.now()
        grace = timedelta(minutes=15)
        if t.status == Trip.Status.SCHEDULED and t.scheduled_departure + grace < now:
            return 'DELAYED'
        if t.status == Trip.Status.DISPATCHED and t.scheduled_return and t.scheduled_return + grace < now:
            return 'OVERDUE'
        return None


# ---------------------------------------------------------------- fuel

class FuelRecordSerializer(serializers.ModelSerializer):
    """Fuel fill-up. Totals, odometer order and vehicle odometer moves are enforced in operations/fuel.py.
    Analytics fields come from fuel.with_analytics() annotations on the viewset queryset."""
    plate_number = serializers.CharField(source='vehicle.plate_number', read_only=True)
    vehicle_label = serializers.SerializerMethodField()
    office_code = serializers.CharField(source='vehicle.office.code', read_only=True)
    vehicle_photo_url = serializers.SerializerMethodField()
    driver_name = serializers.CharField(source='driver.full_name', read_only=True, default=None)
    fuel_type_display = serializers.CharField(source='get_fuel_type_display', read_only=True)
    total_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True,
                                            help_text='Leave empty to compute liters × unit price.')
    distance_since_last = serializers.SerializerMethodField(help_text='km since the previous fill-up of this vehicle.')
    km_per_liter = serializers.SerializerMethodField(help_text='ESTIMATE, full-tank to full-tank only; else null.')
    usual_km_per_liter = serializers.SerializerMethodField(help_text="Vehicle's usual km/L (estimate).")
    unusual = serializers.SerializerMethodField(help_text='km/L well below this vehicle\'s usual figure.')
    attachment_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = FuelRecord
        fields = ['id', 'date', 'vehicle', 'plate_number', 'vehicle_label', 'office_code', 'vehicle_photo_url',
                  'driver', 'driver_name',
                  'po_number', 'supplier', 'fuel_type', 'fuel_type_display', 'liters', 'unit_price', 'total_amount',
                  'odometer', 'is_full_tank', 'receipt_number', 'remarks', 'distance_since_last', 'km_per_liter',
                  'usual_km_per_liter', 'unusual', 'attachment_count', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {'odometer': {'min_value': 0}, 'liters': {'min_value': 0}, 'unit_price': {'min_value': 0}}

    def validate(self, attrs):
        for f in ('po_number', 'receipt_number'):
            if f in attrs:
                attrs[f] = attrs[f].strip().upper()
        if 'supplier' in attrs:
            attrs['supplier'] = ' '.join(attrs['supplier'].split())
        return attrs

    def get_vehicle_label(self, r):
        return f'{r.vehicle.make} {r.vehicle.model}'

    def get_vehicle_photo_url(self, r):
        return r.vehicle.photo.url if r.vehicle.photo else None

    def get_distance_since_last(self, r):
        prev = getattr(r, 'prev_odometer', None)
        return r.odometer - prev if prev is not None else None

    # Decimals go out as strings, like every DecimalField in the API (e.g. "12.00").
    def get_km_per_liter(self, r):
        v = fuel.km_per_liter(r) if hasattr(r, 'prev_full_odometer') else None
        return None if v is None else str(v)

    def get_usual_km_per_liter(self, r):
        cache = self.context.setdefault('avg_cache', {})  # one calculation per vehicle per request
        if r.vehicle_id not in cache:
            cache[r.vehicle_id] = fuel.vehicle_average(r.vehicle_id)
        v = cache[r.vehicle_id]
        return None if v is None else str(v)

    def get_unusual(self, r):
        kml = fuel.km_per_liter(r) if hasattr(r, 'prev_full_odometer') else None
        self.get_usual_km_per_liter(r)
        return fuel.is_unusual(kml, self.context['avg_cache'][r.vehicle_id])
