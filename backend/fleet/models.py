from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models

from accounts.models import Office
from config.base_models import Tracked, non_negative, ordered, safe_upload_to


class Vehicle(Tracked):
    class Status(models.TextChoices):
        SERVICEABLE = 'SERVICEABLE', 'Serviceable'
        IN_USE = 'IN_USE', 'In Use'
        UNDER_MAINTENANCE = 'UNDER_MAINTENANCE', 'Under Maintenance'
        FOR_REPAIR = 'FOR_REPAIR', 'For Repair'
        UNSERVICEABLE = 'UNSERVICEABLE', 'Unserviceable'
        DISPOSED = 'DISPOSED', 'Disposed'

    class Type(models.TextChoices):
        SEDAN = 'SEDAN', 'Sedan'
        SUV = 'SUV', 'SUV'
        VAN = 'VAN', 'Van'
        PICKUP = 'PICKUP', 'Pickup'
        BUS = 'BUS', 'Bus'
        TRUCK = 'TRUCK', 'Truck'
        MOTORCYCLE = 'MOTORCYCLE', 'Motorcycle'
        OTHER = 'OTHER', 'Other'

    class Fuel(models.TextChoices):
        GASOLINE = 'GASOLINE', 'Gasoline'
        DIESEL = 'DIESEL', 'Diesel'
        HYBRID = 'HYBRID', 'Hybrid'
        ELECTRIC = 'ELECTRIC', 'Electric'
        OTHER = 'OTHER', 'Other'

    plate_number = models.CharField(max_length=20, db_index=True)
    # Optional identifiers: NULL (not '') when blank so MySQL UNIQUE allows many blanks.
    property_number = models.CharField(max_length=50, unique=True, null=True, blank=True)
    engine_number = models.CharField(max_length=50, unique=True, null=True, blank=True)
    chassis_number = models.CharField(max_length=50, unique=True, null=True, blank=True)
    make = models.CharField(max_length=50)
    model = models.CharField(max_length=50)
    variant = models.CharField(max_length=50, blank=True)
    year_model = models.PositiveSmallIntegerField(null=True, blank=True)
    vehicle_type = models.CharField(max_length=20, choices=Type.choices)
    color = models.CharField(max_length=30, blank=True)
    fuel_type = models.CharField(max_length=20, choices=Fuel.choices)
    acquisition_date = models.DateField(null=True, blank=True)
    acquisition_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    current_odometer = models.IntegerField(default=0)
    office = models.ForeignKey(Office, on_delete=models.PROTECT, related_name='vehicles',
                               help_text='Owning office; drives office-level access scoping.')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SERVICEABLE, db_index=True)
    photo = models.ImageField(upload_to=safe_upload_to, null=True, blank=True)
    remarks = models.TextField(blank=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['plate_number']
        constraints = non_negative('current_odometer', 'acquisition_cost')
        permissions = [
            ('manage_vehicle_photo', 'Can upload, replace and remove vehicle photos'),
            ('correct_odometer', 'Can lower a vehicle odometer (authorized correction)'),
        ]

    def __str__(self):
        return f'{self.plate_number} ({self.make} {self.model})'

    def clean(self):
        # ponytail: MySQL has no partial unique index, so "unique among non-archived" is enforced here.
        # Race window exists between check and insert; add a DB-level key column if duplicates ever slip through.
        if self.plate_number:
            self.plate_number = self.plate_number.strip().upper()
            dup = Vehicle.objects.filter(plate_number=self.plate_number, is_archived=False).exclude(pk=self.pk)
            if not self.is_archived and dup.exists():
                raise ValidationError({'plate_number': 'An active vehicle with this plate number already exists.'})
        for f in ('property_number', 'engine_number', 'chassis_number'):
            setattr(self, f, (getattr(self, f) or '').strip().upper() or None)

    @property
    def current_assignment(self):
        return self.assignments.filter(end_date__isnull=True).select_related('driver', 'office').first()


class Driver(Tracked):
    class LicenseType(models.TextChoices):
        PROFESSIONAL = 'PROFESSIONAL', 'Professional'
        NON_PROFESSIONAL = 'NON_PROFESSIONAL', 'Non-Professional'

    employee_number = models.CharField(max_length=30, unique=True, null=True, blank=True)
    full_name = models.CharField(max_length=150, db_index=True)
    office = models.ForeignKey(Office, on_delete=models.PROTECT, related_name='drivers')
    contact_number = models.CharField(max_length=30, blank=True)
    license_number = models.CharField(max_length=30, unique=True)
    license_type = models.CharField(max_length=20, choices=LicenseType.choices)
    license_restrictions = models.CharField(max_length=50, blank=True, help_text='e.g. A, B, B1, B2')
    license_issue_date = models.DateField(null=True, blank=True)
    license_expiry_date = models.DateField(db_index=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['full_name']
        constraints = [ordered('license_issue_date', 'license_expiry_date')]

    def __str__(self):
        return self.full_name


class VehicleAssignment(Tracked):
    """History row per assignment. Current assignment = end_date IS NULL; never overwritten, only ended."""
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name='assignments')
    office = models.ForeignKey(Office, on_delete=models.PROTECT, related_name='assignments')
    accountable_person = models.CharField(max_length=150, help_text='Name as of assignment (historical snapshot).')
    driver = models.ForeignKey(Driver, null=True, blank=True, on_delete=models.PROTECT, related_name='assignments')
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = ['-start_date']
        constraints = [ordered('start_date', 'end_date')]
        indexes = [models.Index(fields=['vehicle', 'end_date'])]

    def clean(self):
        # ponytail: one open assignment per vehicle enforced here + in the assignment service (Phase 5, select_for_update).
        if self.end_date is None and self.vehicle_id:
            if VehicleAssignment.objects.filter(vehicle_id=self.vehicle_id, end_date__isnull=True).exclude(pk=self.pk).exists():
                raise ValidationError('This vehicle already has a current assignment. End it before reassigning.')


class VehicleDocument(Tracked):
    """Renewal = new row; the previous one is marked SUPERSEDED, so history is kept."""
    class Type(models.TextChoices):
        LTO_REGISTRATION = 'LTO_REGISTRATION', 'LTO Registration'
        OFFICIAL_RECEIPT = 'OR', 'Official Receipt'
        CERTIFICATE_OF_REGISTRATION = 'CR', 'Certificate of Registration'
        GSIS_INSURANCE = 'GSIS_INSURANCE', 'GSIS Insurance'
        INSURANCE_POLICY = 'INSURANCE_POLICY', 'Insurance Policy'
        DEED = 'DEED', 'Deed / Property Record'
        INSPECTION = 'INSPECTION', 'Inspection Record'
        OTHER = 'OTHER', 'Other'

    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        SUPERSEDED = 'SUPERSEDED', 'Superseded'
        CANCELLED = 'CANCELLED', 'Cancelled'

    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name='documents')
    document_type = models.CharField(max_length=20, choices=Type.choices)
    reference_number = models.CharField(max_length=60, blank=True)
    issue_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True, db_index=True)
    file = models.FileField(upload_to=safe_upload_to, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = ['-expiry_date']
        constraints = [ordered('issue_date', 'expiry_date')]


class Attachment(models.Model):
    """Supporting files for any record (vehicle, driver, trip, fuel, maintenance...)."""
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveBigIntegerField()
    record = GenericForeignKey('content_type', 'object_id')
    file = models.FileField(upload_to=safe_upload_to)
    original_name = models.CharField(max_length=255)
    size = models.PositiveIntegerField()
    description = models.CharField(max_length=255, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    uploaded_by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        indexes = [models.Index(fields=['content_type', 'object_id'])]
