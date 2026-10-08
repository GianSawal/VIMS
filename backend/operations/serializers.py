from rest_framework import serializers

from accounts.models import Office
from fleet.models import Driver, Vehicle

from .models import Trip

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

    class Meta:
        model = Trip
        fields = ['id', 'ticket_number', 'vehicle', 'plate_number', 'vehicle_label', 'office_code', 'driver',
                  'driver_name', 'requesting_office', 'requesting_office_name', 'passengers', 'origin', 'destination',
                  'purpose', 'departed_at', 'returned_at', 'odometer_start', 'odometer_end', 'distance_km', 'status',
                  'status_display', 'remarks', 'created_at', 'updated_at']
        read_only_fields = [f for f in fields if f not in DESCRIPTIVE]

    def get_vehicle_label(self, t):
        return f'{t.vehicle.make} {t.vehicle.model}'


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
