from rest_framework import serializers

from . import documents
from .driver_serializers import check_upload
from .models import Vehicle, VehicleDocument


class DocumentSerializer(serializers.ModelSerializer):
    """Vehicle documents. Status changes only through /documents/{id}/renew/ and /cancel/."""
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    plate_number = serializers.CharField(source='vehicle.plate_number', read_only=True)
    vehicle_label = serializers.SerializerMethodField()
    vehicle_photo_url = serializers.SerializerMethodField()
    office_code = serializers.CharField(source='vehicle.office.code', read_only=True)
    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    file = serializers.FileField(required=False, allow_null=True, validators=[check_upload])
    file_name = serializers.SerializerMethodField()
    expiry = serializers.SerializerMethodField()

    class Meta:
        model = VehicleDocument
        fields = ['id', 'vehicle', 'plate_number', 'vehicle_label', 'vehicle_photo_url', 'office_code', 'document_type',
                  'document_type_display', 'reference_number', 'issue_date', 'expiry_date', 'file', 'file_name', 'status',
                  'status_display', 'remarks', 'expiry', 'created_at', 'updated_at']
        read_only_fields = ['status', 'created_at', 'updated_at']

    def validate_reference_number(self, v):
        return v.strip().upper()

    def get_vehicle_label(self, d):
        return f'{d.vehicle.make} {d.vehicle.model}'

    def get_vehicle_photo_url(self, d):
        return d.vehicle.photo.url if d.vehicle.photo else None

    def get_file_name(self, d):
        return d.file.name.rsplit('/', 1)[-1] if d.file else None

    def get_expiry(self, d):
        """Band and days left; only current documents expire (history and cancelled ones don't alert)."""
        return documents.expiry_state(d.expiry_date) if d.status == VehicleDocument.Status.ACTIVE else None


class RenewSerializer(serializers.Serializer):
    reference_number = serializers.CharField(max_length=60, required=False, allow_blank=True, default='')
    issue_date = serializers.DateField(required=False, allow_null=True)
    expiry_date = serializers.DateField(required=False, allow_null=True)
    file = serializers.FileField(required=False, allow_null=True, validators=[check_upload])
    remarks = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_reference_number(self, v):
        return v.strip().upper()


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)
