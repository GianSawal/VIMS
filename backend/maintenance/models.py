from django.db import models

from config.base_models import Tracked, non_negative, ordered
from fleet.models import Vehicle


class MaintenanceCategory(models.Model):
    name = models.CharField(max_length=60, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'maintenance categories'

    def __str__(self):
        return self.name


class MaintenanceRecord(Tracked):
    class Status(models.TextChoices):
        SCHEDULED = 'SCHEDULED', 'Scheduled'
        FOR_INSPECTION = 'FOR_INSPECTION', 'For Inspection'
        IN_PROGRESS = 'IN_PROGRESS', 'In Progress'
        COMPLETED = 'COMPLETED', 'Completed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name='maintenance_records')
    date = models.DateField(db_index=True)
    odometer = models.IntegerField(null=True, blank=True)
    reference_number = models.CharField('PR / reference number', max_length=40, blank=True)
    categories = models.ManyToManyField(MaintenanceCategory, related_name='records')
    description = models.TextField()
    service_provider = models.CharField(max_length=150, blank=True)
    labor_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    parts_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_cost = models.GeneratedField(
        expression=models.F('labor_cost') + models.F('parts_cost'),
        output_field=models.DecimalField(max_digits=13, decimal_places=2), db_persist=True,
    )
    started_on = models.DateField(null=True, blank=True)
    completed_on = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED, db_index=True)
    next_service_date = models.DateField(null=True, blank=True)
    next_service_odometer = models.IntegerField(null=True, blank=True)
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = ['-date']
        constraints = [*non_negative('odometer', 'labor_cost', 'parts_cost'), ordered('started_on', 'completed_on')]


class MaintenanceSchedule(models.Model):
    """Preventive-maintenance rule per vehicle+category. Due when EITHER configured interval is reached."""
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name='maintenance_schedules')
    category = models.ForeignKey(MaintenanceCategory, on_delete=models.PROTECT, related_name='schedules')
    interval_days = models.PositiveIntegerField(null=True, blank=True)
    interval_km = models.PositiveIntegerField(null=True, blank=True)
    last_service_date = models.DateField(null=True, blank=True)
    last_service_odometer = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['vehicle', 'category'], name='uniq_schedule_vehicle_category'),
            models.CheckConstraint(
                condition=models.Q(interval_days__isnull=False) | models.Q(interval_km__isnull=False),
                name='schedule_has_interval',
            ),
        ]
