"""Serializers for drivers, driver attachments and vehicle assignments."""
import os

from django.conf import settings
from PIL import Image
from rest_framework import serializers

from accounts.models import Office

from .models import Attachment, Driver, VehicleAssignment


class DriverSerializer(serializers.ModelSerializer):
    office = serializers.PrimaryKeyRelatedField(queryset=Office.objects.filter(is_active=True))
    office_name = serializers.CharField(source='office.name', read_only=True)
    office_code = serializers.CharField(source='office.code', read_only=True)
    license_type_display = serializers.CharField(source='get_license_type_display', read_only=True)
    license_status = serializers.SerializerMethodField()
    current_vehicles = serializers.SerializerMethodField()

    class Meta:
        model = Driver
        fields = ['id', 'employee_number', 'full_name', 'office', 'office_name', 'office_code', 'contact_number',
                  'license_number', 'license_type', 'license_type_display', 'license_restrictions',
                  'license_issue_date', 'license_expiry_date', 'license_status', 'is_active', 'current_vehicles',
                  'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']
        # Uniqueness is checked in validate() after normalizing.
        extra_kwargs = {f: {'validators': []} for f in ('employee_number', 'license_number')}

    def get_license_status(self, d):
        return d.license_status()

    def get_current_vehicles(self, d):
        # reads the prefetch set up in DriverViewSet, so lists don't run a query per row
        return [{'assignment_id': a.id, 'vehicle_id': a.vehicle_id, 'plate_number': a.vehicle.plate_number}
                for a in d.assignments.all() if a.end_date is None]

    def validate(self, attrs):
        for f in ('employee_number', 'license_number'):
            if f in attrs:
                attrs[f] = (attrs[f] or '').strip().upper() or None
        if 'full_name' in attrs:
            attrs['full_name'] = ' '.join(attrs['full_name'].split())

        errors = {}
        others = Driver.objects.exclude(pk=self.instance.pk if self.instance else None)
        for f, label in (('employee_number', 'employee number'), ('license_number', 'license number')):
            if attrs.get(f) and others.filter(**{f: attrs[f]}).exists():
                errors[f] = f'Another driver already has this {label}.'
        if self.instance is None and not attrs.get('license_number'):
            errors['license_number'] = 'License number is required.'

        inst = self.instance
        issue = attrs.get('license_issue_date', inst.license_issue_date if inst else None)
        expiry = attrs.get('license_expiry_date', inst.license_expiry_date if inst else None)
        if issue and expiry and expiry < issue:
            errors['license_expiry_date'] = 'Expiry date cannot be before the issue date.'
        if inst and attrs.get('is_active') is False and any(a.end_date is None for a in inst.assignments.all()):
            errors['is_active'] = 'This driver is on a current vehicle assignment. End or reassign it first.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class AttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.CharField(source='uploaded_by.username', read_only=True, default=None)

    class Meta:
        model = Attachment
        fields = ['id', 'original_name', 'description', 'size', 'url', 'uploaded_at', 'uploaded_by_name']

    def get_url(self, a):
        return a.file.url


ATTACHMENT_TYPES = {'.pdf', '.jpg', '.jpeg', '.png', '.webp'}


class AttachmentUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    description = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')

    def validate_file(self, f):
        limit = settings.ATTACHMENT_MAX_BYTES
        if f.size > limit:
            raise serializers.ValidationError(f'File must be {limit // (1024 * 1024)} MB or smaller.')
        ext = os.path.splitext(f.name)[1].lower()
        if ext not in ATTACHMENT_TYPES:
            raise serializers.ValidationError('Only PDF, JPEG, PNG or WebP files are allowed.')
        if ext == '.pdf':
            ok = f.read(5) == b'%PDF-'
        else:  # trust the bytes, not the extension
            try:
                Image.open(f).verify()
                ok = True
            except Exception:
                ok = False
        f.seek(0)
        if not ok:
            raise serializers.ValidationError('The file content does not match its type.')
        return f


class AssignmentSerializer(serializers.ModelSerializer):
    office_name = serializers.CharField(source='office.name', read_only=True)
    office_code = serializers.CharField(source='office.code', read_only=True)
    plate_number = serializers.CharField(source='vehicle.plate_number', read_only=True)
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = VehicleAssignment
        fields = ['id', 'vehicle', 'plate_number', 'office', 'office_name', 'office_code', 'accountable_person',
                  'driver', 'driver_name', 'start_date', 'end_date', 'is_current', 'remarks', 'created_at']

    def get_is_current(self, a):
        return a.end_date is None


class AssignInputSerializer(serializers.Serializer):
    """Body of POST /vehicles/{id}/assignments/: starts a new assignment (ending the current one, if any)."""
    office = serializers.PrimaryKeyRelatedField(queryset=Office.objects.filter(is_active=True))
    accountable_person = serializers.CharField(max_length=150)
    driver = serializers.PrimaryKeyRelatedField(queryset=Driver.objects.all(), required=False, allow_null=True)
    start_date = serializers.DateField()
    remarks = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_accountable_person(self, v):
        v = ' '.join(v.split())
        if not v:
            raise serializers.ValidationError('This field may not be blank.')
        return v


class EndAssignmentSerializer(serializers.Serializer):
    end_date = serializers.DateField()
