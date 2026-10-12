from rest_framework import serializers

from accounts.permissions import scope_to_offices
from fleet.models import Vehicle

from . import service
from .models import MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = MaintenanceCategory
        fields = ['id', 'name', 'is_active']

    def validate_name(self, v):
        v = ' '.join(v.split())
        if MaintenanceCategory.objects.filter(name__iexact=v).exclude(pk=self.instance.pk if self.instance else None).exists():
            raise serializers.ValidationError('A category with this name already exists.')
        return v


class RecordSerializer(serializers.ModelSerializer):
    """Create/edit descriptive fields. Status changes only through /maintenance/{id}/status/."""
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    plate_number = serializers.CharField(source='vehicle.plate_number', read_only=True)
    vehicle_label = serializers.SerializerMethodField()
    vehicle_photo_url = serializers.SerializerMethodField()
    office_code = serializers.CharField(source='vehicle.office.code', read_only=True)
    categories = serializers.PrimaryKeyRelatedField(queryset=MaintenanceCategory.objects.filter(is_active=True), many=True)
    category_names = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    total_cost = serializers.DecimalField(max_digits=13, decimal_places=2, read_only=True)
    attachment_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = MaintenanceRecord
        fields = ['id', 'vehicle', 'plate_number', 'vehicle_label', 'vehicle_photo_url', 'office_code', 'date',
                  'odometer', 'reference_number', 'categories', 'category_names', 'description', 'service_provider',
                  'labor_cost', 'parts_cost', 'total_cost', 'started_on', 'completed_on', 'status', 'status_display',
                  'next_service_date', 'next_service_odometer', 'remarks', 'attachment_count', 'created_at', 'updated_at']
        read_only_fields = ['started_on', 'completed_on', 'status', 'created_at', 'updated_at']
        extra_kwargs = {'odometer': {'min_value': 0}, 'labor_cost': {'min_value': 0}, 'parts_cost': {'min_value': 0},
                        'next_service_odometer': {'min_value': 0}}

    def validate(self, attrs):
        for f in ('reference_number',):
            if f in attrs:
                attrs[f] = attrs[f].strip().upper()
        if 'service_provider' in attrs:
            attrs['service_provider'] = ' '.join(attrs['service_provider'].split())
        return attrs

    def get_vehicle_label(self, r):
        return f'{r.vehicle.make} {r.vehicle.model}'

    def get_vehicle_photo_url(self, r):
        return r.vehicle.photo.url if r.vehicle.photo else None

    def get_category_names(self, r):
        return [c.name for c in r.categories.all()]


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=MaintenanceRecord.Status.choices)
    completed_on = serializers.DateField(required=False)
    odometer = serializers.IntegerField(required=False, min_value=0)
    labor_cost = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=0)
    parts_cost = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=0)
    next_service_date = serializers.DateField(required=False, allow_null=True)
    next_service_odometer = serializers.IntegerField(required=False, allow_null=True, min_value=0)


class ScheduleSerializer(serializers.ModelSerializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    plate_number = serializers.CharField(source='vehicle.plate_number', read_only=True)
    vehicle_label = serializers.SerializerMethodField()
    vehicle_photo_url = serializers.SerializerMethodField()
    vehicle_odometer = serializers.IntegerField(source='vehicle.current_odometer', read_only=True)
    office_code = serializers.CharField(source='vehicle.office.code', read_only=True)
    category = serializers.PrimaryKeyRelatedField(queryset=MaintenanceCategory.objects.filter(is_active=True))
    category_name = serializers.CharField(source='category.name', read_only=True)
    due = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceSchedule
        fields = ['id', 'vehicle', 'plate_number', 'vehicle_label', 'vehicle_photo_url', 'vehicle_odometer',
                  'office_code', 'category', 'category_name', 'interval_days', 'interval_km', 'last_service_date',
                  'last_service_odometer', 'is_active', 'due']
        extra_kwargs = {'interval_days': {'min_value': 1}, 'interval_km': {'min_value': 1},
                        'last_service_odometer': {'min_value': 0}}
        validators = []  # uniqueness checked below for a friendlier message

    def get_due(self, s):
        return service.schedule_state(s)

    def get_vehicle_label(self, s):
        return f'{s.vehicle.make} {s.vehicle.model}'

    def get_vehicle_photo_url(self, s):
        return s.vehicle.photo.url if s.vehicle.photo else None

    def validate(self, attrs):
        inst = self.instance
        days = attrs.get('interval_days', inst.interval_days if inst else None)
        km = attrs.get('interval_km', inst.interval_km if inst else None)
        if not days and not km:
            raise serializers.ValidationError({'interval_days': ['Set a day interval, a kilometre interval, or both.']})
        vehicle, category = attrs.get('vehicle', inst.vehicle if inst else None), attrs.get('category', inst.category if inst else None)
        if 'vehicle' in attrs and not scope_to_offices(Vehicle.objects.filter(pk=vehicle.pk), self.context['request'].user, 'office').exists():
            raise serializers.ValidationError({'vehicle': ['You do not have access to this vehicle.']})
        if MaintenanceSchedule.objects.filter(vehicle=vehicle, category=category).exclude(pk=inst.pk if inst else None).exists():
            raise serializers.ValidationError({'category': ['This vehicle already has a schedule for this category.']})
        return attrs
