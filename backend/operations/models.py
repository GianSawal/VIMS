import secrets

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Coalesce

from accounts.models import Office
from config.base_models import Tracked, non_negative, ordered
from django.contrib.contenttypes.fields import GenericRelation

from fleet.models import Attachment, Driver, Vehicle


def new_display_token():
    return secrets.token_urlsafe(32)


class Trip(Tracked):
    class Status(models.TextChoices):
        SCHEDULED = 'SCHEDULED', 'Scheduled'
        DISPATCHED = 'DISPATCHED', 'Dispatched'
        COMPLETED = 'COMPLETED', 'Completed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    ticket_number = models.CharField(max_length=40, unique=True)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name='trips')
    driver = models.ForeignKey(Driver, on_delete=models.PROTECT, related_name='trips')
    requesting_office = models.ForeignKey(Office, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    passengers = models.TextField(blank=True)
    origin = models.CharField(max_length=200)
    destination = models.CharField(max_length=255)
    purpose = models.TextField()
    # Planned times; set when a trip is booked ahead (status SCHEDULED). Shown on the TV display.
    scheduled_departure = models.DateTimeField(null=True, blank=True, db_index=True)
    scheduled_return = models.DateTimeField(null=True, blank=True, help_text='Expected return (planning only).')
    # Actual times/readings; empty while scheduled, filled at dispatch (odometer read on the day itself).
    departed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    odometer_start = models.IntegerField(null=True, blank=True)
    odometer_end = models.IntegerField(null=True, blank=True)
    # Map driving estimate (Geoapify / OpenStreetMap), ONE WAY, captured when the trip was planned.
    estimated_distance_km = models.DecimalField(max_digits=7, decimal_places=1, null=True, blank=True)
    estimated_duration_min = models.PositiveIntegerField(null=True, blank=True)
    origin_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    origin_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    destination_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    destination_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    route_geometry = models.JSONField(null=True, blank=True, help_text='Driving route [[lat, lng], ...] (thinned).')
    distance_km = models.GeneratedField(
        expression=models.F('odometer_end') - models.F('odometer_start'),
        output_field=models.IntegerField(null=True), db_persist=True,
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DISPATCHED, db_index=True)
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = [Coalesce('departed_at', 'scheduled_departure').desc(nulls_last=True), '-id']
        constraints = [
            *non_negative('odometer_start'),
            ordered('odometer_start', 'odometer_end'),
            ordered('departed_at', 'returned_at'),
            ordered('scheduled_departure', 'scheduled_return'),
            # Once a trip has actually left, its departure time and starting odometer are mandatory.
            models.CheckConstraint(
                condition=models.Q(status__in=['SCHEDULED', 'CANCELLED'])
                | models.Q(departed_at__isnull=False, odometer_start__isnull=False),
                name='trip_started_has_departure_and_odometer'),
            models.CheckConstraint(
                condition=~models.Q(status='SCHEDULED') | models.Q(scheduled_departure__isnull=False),
                name='trip_scheduled_has_departure_time'),
        ]

    def __str__(self):
        return self.ticket_number

    def clean(self):
        if self.odometer_end is not None and self.odometer_start is not None and self.odometer_end < self.odometer_start:
            raise ValidationError({'odometer_end': 'Ending odometer cannot be below starting odometer.'})


class FuelRecord(Tracked):
    """Also the source of the Fuel PO log (rows with po_number), so PO data is never entered twice."""
    date = models.DateField(db_index=True)
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name='fuel_records')
    driver = models.ForeignKey(Driver, null=True, blank=True, on_delete=models.PROTECT, related_name='fuel_records')
    po_number = models.CharField('PO number', max_length=40, blank=True, db_index=True)
    supplier = models.CharField(max_length=150, blank=True)
    fuel_type = models.CharField(max_length=20, choices=Vehicle.Fuel.choices)
    liters = models.DecimalField(max_digits=9, decimal_places=3)
    unit_price = models.DecimalField(max_digits=9, decimal_places=2)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, help_text='As printed on the receipt.')
    odometer = models.IntegerField()
    is_full_tank = models.BooleanField(default=False, help_text='Only full-tank fill-ups give a fair km/L estimate.')
    receipt_number = models.CharField(max_length=40, blank=True)
    remarks = models.TextField(blank=True)
    attachments = GenericRelation(Attachment)  # receipt / PO scans; lets the PO log count them

    class Meta:
        ordering = ['-date', '-odometer']
        constraints = non_negative('liters', 'unit_price', 'total_amount', 'odometer')
        indexes = [models.Index(fields=['vehicle', 'date']), models.Index(fields=['vehicle', 'odometer'])]

    def __str__(self):
        return f'{self.vehicle.plate_number} {self.date:%Y-%m-%d} {self.liters} L'


class RFIDAccount(Tracked):
    class Provider(models.TextChoices):
        EASYTRIP = 'EASYTRIP', 'Easytrip'
        AUTOSWEEP = 'AUTOSWEEP', 'Autosweep'
        OTHER = 'OTHER', 'Other'

    # ponytail: no credential field at all. Third-party passwords are out of scope (spec §5.8);
    # add an encrypted field in Phase 10 only if the client explicitly requires it.
    provider = models.CharField(max_length=20, choices=Provider.choices)
    account_number = models.CharField(max_length=40)
    vehicle = models.ForeignKey(Vehicle, null=True, blank=True, on_delete=models.PROTECT, related_name='rfid_accounts')
    is_active = models.BooleanField(default=True)
    balance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True,
                                  help_text='Manually recorded balance.')
    remarks = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['provider', 'account_number'], name='uniq_rfid_account')]

    def __str__(self):
        return f'{self.get_provider_display()} {self.account_number}'


class TollTransaction(Tracked):
    account = models.ForeignKey(RFIDAccount, on_delete=models.PROTECT, related_name='transactions')
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name='toll_transactions')
    trip = models.ForeignKey(Trip, null=True, blank=True, on_delete=models.SET_NULL, related_name='toll_transactions')
    transacted_at = models.DateTimeField(db_index=True)
    description = models.CharField(max_length=200, help_text='Toll plaza / load / adjustment')
    credit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    debit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    reference_number = models.CharField(max_length=60, blank=True)

    class Meta:
        ordering = ['-transacted_at']
        constraints = non_negative('credit', 'debit')


class DisplayScreen(models.Model):
    """A TV/kiosk allowed to read the public trip schedule via a secret link. Revoke by deactivating."""
    name = models.CharField(max_length=100, help_text='e.g. "Lobby TV, Regional Office"')
    office = models.ForeignKey(Office, null=True, blank=True, on_delete=models.PROTECT, related_name='+',
                               help_text='Show only this office\'s vehicles. Empty = all offices.')
    # ponytail: stored as-is so admins can re-copy the link; it only unlocks the public schedule fields.
    # Hash it if the display ever exposes more than plate/driver/destination/times.
    token = models.CharField(max_length=64, unique=True, default=new_display_token, editable=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.name
