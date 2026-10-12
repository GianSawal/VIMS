"""
Maintenance rules. One place, so the API and the Excel import can't bypass them.

Status flow:  SCHEDULED -> FOR_INSPECTION -> IN_PROGRESS -> COMPLETED   (steps may be skipped, never reversed)
              any open status -> CANCELLED.   COMPLETED / CANCELLED are final: only remarks and attachments change.

Vehicle status: while a record is IN_PROGRESS the vehicle is UNDER_MAINTENANCE (so trips can't dispatch it);
when the last such record ends it goes back to SERVICEABLE.

Completing a record refreshes the preventive-maintenance schedules of its categories (last service date and
odometer) and suggests the next service date/odometer from the schedule intervals.

Due rule per schedule: due when EITHER interval is reached (date interval from the last service date, km
interval from the last service odometer). "Due soon" = within MAINTENANCE_DUE_SOON_DAYS / _KM of that point.
"""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from accounts.permissions import scope_to_offices
from fleet.models import Vehicle

from .models import MaintenanceRecord, MaintenanceSchedule

S = MaintenanceRecord.Status
OPEN = (S.SCHEDULED, S.FOR_INSPECTION, S.IN_PROGRESS)
FORWARD = [S.SCHEDULED, S.FOR_INSPECTION, S.IN_PROGRESS, S.COMPLETED]


def _fail(field, msg):
    raise serializers.ValidationError({field: [msg]})


def _check_vehicle(user, vehicle):
    if not scope_to_offices(Vehicle.objects.filter(pk=vehicle.pk), user, 'office').exists():
        _fail('vehicle', 'You do not have access to this vehicle.')


def _check_dates(data):
    nxt, date, odo = data.get('next_service_date'), data.get('date'), data.get('odometer')
    if nxt and date and nxt < date:
        _fail('next_service_date', 'Next service date cannot be before the maintenance date.')
    if data.get('next_service_odometer') is not None and odo is not None and data['next_service_odometer'] < odo:
        _fail('next_service_odometer', 'Next service odometer cannot be below this odometer reading.')
    if data.get('started_on') and data.get('completed_on') and data['completed_on'] < data['started_on']:
        _fail('completed_on', 'Completion date cannot be before the start date.')


# ---------------------------------------------------------------- records

def save_record(*, user, instance=None, data, categories=None):
    """Create or edit a record. Final records only accept remarks."""
    if instance is not None and instance.status not in OPEN:
        extra = set(data) - {'remarks'}
        if extra or categories is not None:
            raise serializers.ValidationError(f'{instance.get_status_display()} records are final; only remarks can change.')
    vehicle = data.get('vehicle', instance.vehicle if instance else None)
    if instance is None or data.get('vehicle'):
        _check_vehicle(user, vehicle)
        if vehicle.is_archived or vehicle.status == Vehicle.Status.DISPOSED:
            _fail('vehicle', 'Archived or disposed vehicles cannot be serviced.')
    if instance is None and not categories:
        _fail('categories', 'Choose at least one category.')
    if categories is not None and not categories:
        _fail('categories', 'Choose at least one category.')
    merged = {f: getattr(instance, f) for f in ('date', 'odometer', 'next_service_date', 'next_service_odometer',
                                                  'started_on', 'completed_on')} if instance else {}
    merged.update(data)
    _check_dates(merged)

    with transaction.atomic():
        if instance is None:
            data.pop('status', None)  # records always start SCHEDULED; status changes go through change_status
            record = MaintenanceRecord.objects.create(created_by=user, **data)
        else:
            for k, v in data.items():
                setattr(instance, k, v)
            instance.save()
            record = instance
        if categories is not None:
            record.categories.set(categories)
    return record


def _vehicle_after_close(vehicle):
    """Back to Serviceable once no other record keeps the vehicle in the workshop."""
    still = MaintenanceRecord.objects.filter(vehicle=vehicle, status=S.IN_PROGRESS).exists()
    if vehicle.status == Vehicle.Status.UNDER_MAINTENANCE and not still:
        vehicle.status = Vehicle.Status.SERVICEABLE
        vehicle.save(update_fields=['status', 'updated_at'])


def change_status(record, *, user, status, completed_on=None, odometer=None, labor_cost=None, parts_cost=None,
                  next_service_date=None, next_service_odometer=None):
    """Move a record along its flow. Returns (record, notes) where notes lists side effects for the audit log."""
    today = timezone.localdate()
    notes = []
    with transaction.atomic():
        vehicle = Vehicle.objects.select_for_update().get(pk=record.vehicle_id)
        record = MaintenanceRecord.objects.select_for_update().get(pk=record.pk)
        if record.status not in OPEN:
            raise serializers.ValidationError(f'This record is already {record.get_status_display().lower()}.')
        if status == record.status:
            raise serializers.ValidationError(f'This record is already {record.get_status_display().lower()}.')
        if status != S.CANCELLED and (status not in FORWARD or FORWARD.index(status) < FORWARD.index(record.status)):
            raise serializers.ValidationError('A record cannot move backwards. Cancel it and create a new one if needed.')

        if status == S.IN_PROGRESS:
            if vehicle.is_archived or vehicle.status in (Vehicle.Status.DISPOSED, Vehicle.Status.UNSERVICEABLE):
                _fail('status', f'This vehicle is {vehicle.get_status_display().lower()}; it cannot enter the workshop.')
            if vehicle.trips.filter(status='DISPATCHED').exists():
                _fail('status', 'This vehicle is out on a trip. Record its return before starting maintenance.')
            record.started_on = record.started_on or today
            if vehicle.status != Vehicle.Status.UNDER_MAINTENANCE:
                vehicle.status = Vehicle.Status.UNDER_MAINTENANCE
                vehicle.save(update_fields=['status', 'updated_at'])
                notes.append('vehicle set to Under Maintenance')

        elif status == S.COMPLETED:
            done = completed_on or today
            if done > today:
                _fail('completed_on', 'Completion date cannot be in the future.')
            start = record.started_on or record.date
            if done < start:
                _fail('completed_on', f'Completion date cannot be before the start ({start:%b %d, %Y}).')
            if labor_cost is not None:
                record.labor_cost = labor_cost
            if parts_cost is not None:
                record.parts_cost = parts_cost
            if odometer is not None:
                record.odometer = odometer
            record.completed_on, record.started_on = done, record.started_on or start
            if odometer is not None and odometer > vehicle.current_odometer:
                notes.append(f'vehicle odometer {vehicle.current_odometer} -> {odometer}')
                vehicle.current_odometer = odometer
                vehicle.save(update_fields=['current_odometer', 'updated_at'])
            _refresh_schedules(record, next_service_date, next_service_odometer, notes)

        was_in_workshop = record.status == S.IN_PROGRESS
        record.status = status
        _check_dates({f: getattr(record, f) for f in ('date', 'odometer', 'next_service_date', 'next_service_odometer',
                                                      'started_on', 'completed_on')})
        record.save()
        if was_in_workshop and status in (S.COMPLETED, S.CANCELLED):
            _vehicle_after_close(vehicle)  # after the save, so this record no longer counts as in progress
            if vehicle.status == Vehicle.Status.SERVICEABLE:
                notes.append('vehicle back to Serviceable')
    record.refresh_from_db()  # total_cost is DB-generated
    return record, notes


def _refresh_schedules(record, next_date, next_odo, notes):
    """Completed record -> reset the schedules of its categories; suggest the next service if none was typed."""
    done, odo = record.completed_on, record.odometer
    suggestions_date, suggestions_odo = [], []
    for sch in MaintenanceSchedule.objects.filter(vehicle=record.vehicle, is_active=True, category__in=record.categories.all()):
        changed = False
        if sch.last_service_date is None or done >= sch.last_service_date:
            sch.last_service_date, changed = done, True
            if odo is not None:
                sch.last_service_odometer = odo
        if changed:
            sch.save()
            notes.append(f'schedule "{sch.category}" reset')
        if sch.interval_days:
            suggestions_date.append(done + timedelta(days=sch.interval_days))
        if sch.interval_km and odo is not None:
            suggestions_odo.append(odo + sch.interval_km)
    # Typed values win, then what was already on the record, then the earliest suggestion from the schedules.
    record.next_service_date = next_date or record.next_service_date or (min(suggestions_date) if suggestions_date else None)
    if next_odo is not None:
        record.next_service_odometer = next_odo
    elif record.next_service_odometer is None and suggestions_odo:
        record.next_service_odometer = min(suggestions_odo)


# ---------------------------------------------------------------- schedules (due / overdue)

def schedule_state(sch, today=None):
    """
    Compute when a schedule is due and how close it is.
    Returns dict: status (OVERDUE / DUE_SOON / OK / NO_BASELINE), due_date, due_odometer, days_left, km_left.
    A rule without a baseline (no last service recorded) can't be computed; with no computable rule: NO_BASELINE.
    """
    today = today or timezone.localdate()
    odometer = sch.vehicle.current_odometer
    due_date = days_left = due_odo = km_left = None
    if sch.interval_days and sch.last_service_date:
        due_date = sch.last_service_date + timedelta(days=sch.interval_days)
        days_left = (due_date - today).days
    if sch.interval_km and sch.last_service_odometer is not None:
        due_odo = sch.last_service_odometer + sch.interval_km
        km_left = due_odo - odometer

    if days_left is None and km_left is None:
        status = 'NO_BASELINE'
    elif (days_left is not None and days_left < 0) or (km_left is not None and km_left < 0):
        status = 'OVERDUE'
    elif ((days_left is not None and days_left <= settings.MAINTENANCE_DUE_SOON_DAYS)
          or (km_left is not None and km_left <= settings.MAINTENANCE_DUE_SOON_KM)):
        status = 'DUE_SOON'
    else:
        status = 'OK'
    return {'status': status, 'due_date': due_date, 'days_left': days_left, 'due_odometer': due_odo, 'km_left': km_left}
