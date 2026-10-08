from django.conf import settings
from rest_framework import serializers

from accounts.models import Office

from .models import Vehicle

IDENTIFIERS = ('property_number', 'engine_number', 'chassis_number')


class VehicleSerializer(serializers.ModelSerializer):
    office = serializers.PrimaryKeyRelatedField(queryset=Office.objects.filter(is_active=True))
    office_name = serializers.CharField(source='office.name', read_only=True)
    office_code = serializers.CharField(source='office.code', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    vehicle_type_display = serializers.CharField(source='get_vehicle_type_display', read_only=True)
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Vehicle
        fields = ['id', 'plate_number', 'property_number', 'make', 'model', 'variant', 'year_model',
                  'vehicle_type', 'vehicle_type_display', 'color', 'engine_number', 'chassis_number',
                  'fuel_type', 'acquisition_date', 'acquisition_cost', 'current_odometer', 'office',
                  'office_name', 'office_code', 'status', 'status_display', 'photo_url', 'remarks',
                  'is_archived', 'archived_at', 'created_at', 'updated_at']
        read_only_fields = ['is_archived', 'archived_at', 'created_at', 'updated_at']
        # Uniqueness is checked in validate() after normalizing (trim/upper, blank -> NULL).
        extra_kwargs = {f: {'validators': []} for f in IDENTIFIERS}

    def get_photo_url(self, v):
        return v.photo.url if v.photo else None

    def validate_year_model(self, year):
        if year is not None and not 1950 <= year <= 2100:
            raise serializers.ValidationError('Enter a valid year.')
        return year

    def validate(self, attrs):
        if self.instance and self.instance.is_archived:
            raise serializers.ValidationError('Archived vehicles are read-only. Reactivate the vehicle to edit it.')
        if self.instance and self.instance.status == Vehicle.Status.DISPOSED and attrs.get('status', 'DISPOSED') != 'DISPOSED':
            raise serializers.ValidationError({'status': 'A disposed vehicle cannot return to service.'})

        if 'plate_number' in attrs:
            attrs['plate_number'] = attrs['plate_number'].strip().upper()
        for f in IDENTIFIERS:
            if f in attrs:
                attrs[f] = (attrs[f] or '').strip().upper() or None

        others = Vehicle.objects.exclude(pk=self.instance.pk if self.instance else None)
        errors = {}
        plate = attrs.get('plate_number')
        if plate and others.filter(plate_number=plate, is_archived=False).exists():
            errors['plate_number'] = 'An active vehicle with this plate number already exists.'
        for f in IDENTIFIERS:
            if attrs.get(f) and others.filter(**{f: attrs[f]}).exists():
                errors[f] = f'Another vehicle already has this {Vehicle._meta.get_field(f).verbose_name}.'

        odo = attrs.get('current_odometer')
        if self.instance and odo is not None and odo < self.instance.current_odometer:
            if not self.context['request'].user.has_perm('fleet.correct_odometer'):
                errors['current_odometer'] = (f'Odometer cannot go below the recorded {self.instance.current_odometer:,} km. '
                                              'Ask a System Administrator for an authorized correction.')
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class VehicleDetailSerializer(VehicleSerializer):
    current_assignment = serializers.SerializerMethodField()

    class Meta(VehicleSerializer.Meta):
        fields = VehicleSerializer.Meta.fields + ['current_assignment']

    def get_current_assignment(self, v):
        a = v.current_assignment
        if not a:
            return None
        return {'id': a.id, 'office': a.office.name, 'accountable_person': a.accountable_person,
                'driver': a.driver_name or None, 'driver_id': a.driver_id, 'start_date': a.start_date}


class PhotoSerializer(serializers.Serializer):
    photo = serializers.ImageField()  # Pillow opens the file, so non-images are rejected

    def validate_photo(self, f):
        if f.size > settings.VEHICLE_PHOTO_MAX_BYTES:
            raise serializers.ValidationError(f'Photo must be {settings.VEHICLE_PHOTO_MAX_BYTES // (1024 * 1024)} MB or smaller.')
        fmt = getattr(f.image, 'format', None)
        if fmt not in ('JPEG', 'PNG', 'WEBP'):
            raise serializers.ValidationError('Only JPEG, PNG or WebP images are allowed.')
        f.name = f'photo.{"jpg" if fmt == "JPEG" else fmt.lower()}'  # extension from real content, not the client
        return f
