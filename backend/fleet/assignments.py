"""Assignment rules. One place, so the API (and later the Excel import) can't bypass them."""
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from accounts.permissions import check_office_access, scope_to_offices

from .models import Driver, Vehicle, VehicleAssignment


def _fail(field, msg):
    raise serializers.ValidationError({field: msg})


def start_assignment(vehicle, *, user, office, accountable_person, start_date, driver=None, remarks=''):
    """
    Start a new assignment for `vehicle`, ending its current one on the same date (handover day).
    History is never edited: the old row only gets an end_date. Returns (new_assignment, ended_assignment|None).
    """
    check_office_access(user, office)
    today = timezone.localdate()
    if start_date > today:
        _fail('start_date', 'Start date cannot be in the future.')

    with transaction.atomic():
        # Lock the vehicle row so two simultaneous requests can't both open an assignment.
        vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
        if vehicle.is_archived or vehicle.status == Vehicle.Status.DISPOSED:
            raise serializers.ValidationError('Archived or disposed vehicles cannot be assigned.')

        if driver is not None:
            if not scope_to_offices(Driver.objects.filter(pk=driver.pk), user, 'office').exists():
                _fail('driver', 'You do not have access to this driver.')
            if not driver.is_active:
                _fail('driver', 'This driver is inactive.')
            if driver.license_expiry_date < start_date:
                _fail('driver', f'This driver\'s license expired on {driver.license_expiry_date:%b %d, %Y}.')

        current = vehicle.assignments.filter(end_date__isnull=True).first()
        if current and start_date < current.start_date:
            _fail('start_date', f'Start date cannot be before the current assignment began ({current.start_date:%b %d, %Y}).')
        if vehicle.assignments.filter(end_date__gt=start_date).exists():
            _fail('start_date', 'This period overlaps an earlier assignment in the history.')

        if current:
            current.end_date = start_date
            current.save(update_fields=['end_date', 'updated_at'])
        new = VehicleAssignment.objects.create(
            vehicle=vehicle, office=office, accountable_person=accountable_person, driver=driver,
            driver_name=driver.full_name if driver else '', start_date=start_date, remarks=remarks, created_by=user)
    return new, current


def end_assignment(vehicle, *, end_date):
    """End the current assignment without starting another (vehicle becomes unassigned)."""
    today = timezone.localdate()
    if end_date > today:
        _fail('end_date', 'End date cannot be in the future.')
    with transaction.atomic():
        vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
        current = vehicle.assignments.filter(end_date__isnull=True).first()
        if not current:
            raise serializers.ValidationError('This vehicle has no current assignment.')
        if end_date < current.start_date:
            _fail('end_date', f'End date cannot be before the assignment began ({current.start_date:%b %d, %Y}).')
        current.end_date = end_date
        current.save(update_fields=['end_date', 'updated_at'])
    return current
