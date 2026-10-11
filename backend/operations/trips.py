"""
Trip rules: schedule, dispatch, complete, cancel. One place, so the API and the Excel import can't bypass them.

Lifecycle: SCHEDULED (booked ahead, no odometer) -> DISPATCHED (left; odometer read that day) -> COMPLETED,
or a trip can be dispatched directly without scheduling. SCHEDULED or DISPATCHED trips can be CANCELLED.

Odometer: a trip starts at or above the vehicle's accepted odometer and, on completion, moves the vehicle's
odometer forward to the trip's ending reading. Lowering an odometer is only possible through the
authorized correction on the vehicle itself.
"""
import uuid
from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from accounts.permissions import scope_to_offices
from fleet.models import Driver, Vehicle

from .models import Trip

# A vehicle in any other status (maintenance, repair, unserviceable, disposed) is not dispatched.
DISPATCHABLE = {Vehicle.Status.SERVICEABLE, Vehicle.Status.IN_USE}
# Booking ahead is allowed while a vehicle is in maintenance/repair (it may be back by then), but not these.
NOT_SCHEDULABLE = {Vehicle.Status.UNSERVICEABLE, Vehicle.Status.DISPOSED}


def _fail(field, msg):
    raise serializers.ValidationError({field: [msg]})  # list, like DRF field errors


def _lock_vehicle(pk):
    """Row lock: two requests can't both dispatch, complete or cancel trips of one vehicle at the same time."""
    return Vehicle.objects.select_for_update().get(pk=pk)


def _check_scope(user, vehicle, driver):
    if not scope_to_offices(Vehicle.objects.filter(pk=vehicle.pk), user, 'office').exists():
        _fail('vehicle', 'You do not have access to this vehicle.')
    if not scope_to_offices(Driver.objects.filter(pk=driver.pk), user, 'office').exists():
        _fail('driver', 'You do not have access to this driver.')


def _check_driver(driver, on_date):
    if not driver.is_active:
        _fail('driver', 'This driver is inactive.')
    if driver.license_expiry_date < on_date:
        _fail('driver', f"This driver's license expired on {driver.license_expiry_date:%b %d, %Y}.")


def _check_ticket(ticket, exclude=None):
    ticket = (ticket or '').strip().upper()
    if ticket and Trip.objects.filter(ticket_number=ticket).exclude(pk=exclude).exists():
        _fail('ticket_number', 'A trip with this ticket number already exists.')
    return ticket


def _auto_number(trip, when):
    """TT-YYYY-NNNNN from the primary key: unique without a counter table or a race."""
    trip.ticket_number = f'TT-{timezone.localtime(when):%Y}-{trip.pk:05d}'
    trip.save(update_fields=['ticket_number'])


def _check_departure(vehicle, driver, departed_at, odometer_start, exclude=None):
    """Everything that must hold at the moment a vehicle actually leaves. Caller holds the vehicle lock."""
    if vehicle.is_archived:
        _fail('vehicle', 'Archived vehicles cannot be dispatched.')
    if vehicle.status not in DISPATCHABLE:
        _fail('vehicle', f'This vehicle is {vehicle.get_status_display().lower()} and cannot be dispatched.')
    open_trip = vehicle.trips.filter(status=Trip.Status.DISPATCHED).exclude(pk=exclude).first()
    if open_trip:
        _fail('vehicle', f'This vehicle is still out on trip {open_trip.ticket_number}. Complete or cancel it first.')
    _check_driver(driver, timezone.localtime(departed_at).date())
    busy = driver.trips.filter(status=Trip.Status.DISPATCHED).exclude(pk=exclude).first()
    if busy:
        _fail('driver', f'This driver is still out on trip {busy.ticket_number}.')
    if odometer_start < vehicle.current_odometer:
        _fail('odometer_start', f'The vehicle odometer is already at {vehicle.current_odometer:,} km. '
                                'The starting reading cannot be lower.')


def _mark_in_use(vehicle):
    if vehicle.status == Vehicle.Status.SERVICEABLE:
        vehicle.status = Vehicle.Status.IN_USE
        vehicle.save(update_fields=['status', 'updated_at'])


# ---------------------------------------------------------------- scheduling

def booking_window(start, end):
    """A booking without an expected return blocks the rest of its departure day."""
    if end:
        return start, end
    day_end = timezone.make_aware(datetime.combine(timezone.localtime(start).date(), time.max))
    return start, day_end


def _check_booking(vehicle, driver, start, end, exclude=None):
    if vehicle.is_archived or vehicle.status in NOT_SCHEDULABLE:
        _fail('vehicle', 'Archived, unserviceable or disposed vehicles cannot be scheduled.')
    if start < timezone.now() - timedelta(minutes=5):
        _fail('scheduled_departure', 'The scheduled departure must be in the future.')
    if end and end < start:
        _fail('scheduled_return', 'Expected return cannot be before the scheduled departure.')
    _check_driver(driver, timezone.localtime(start).date())

    s, e = booking_window(start, end)
    clashes = Trip.objects.filter(status=Trip.Status.SCHEDULED).exclude(pk=exclude).filter(
        scheduled_departure__lt=e).select_related('vehicle', 'driver')
    for other in clashes:
        os_, oe = booking_window(other.scheduled_departure, other.scheduled_return)
        if os_ < e and s < oe:
            when = timezone.localtime(other.scheduled_departure).strftime('%b %d, %I:%M %p')
            if other.vehicle_id == vehicle.pk:
                _fail('vehicle', f'This vehicle is already booked on {other.ticket_number} ({when}).')
            if other.driver_id == driver.pk:
                _fail('driver', f'This driver is already booked on {other.ticket_number} ({when}).')


def schedule(*, user, vehicle, driver, scheduled_departure, scheduled_return=None, ticket_number='', **fields):
    """Book a trip ahead. No odometer yet: it is read on the day, at dispatch."""
    _check_scope(user, vehicle, driver)
    ticket = _check_ticket(ticket_number)
    with transaction.atomic():
        vehicle = _lock_vehicle(vehicle.pk)
        _check_booking(vehicle, driver, scheduled_departure, scheduled_return)
        trip = Trip.objects.create(
            ticket_number=ticket or f'PENDING-{uuid.uuid4().hex}', status=Trip.Status.SCHEDULED,
            vehicle=vehicle, driver=driver, scheduled_departure=scheduled_departure,
            scheduled_return=scheduled_return, created_by=user, **fields)
        if not ticket:
            _auto_number(trip, scheduled_departure)
    return trip


def reschedule(trip, *, user, vehicle, driver, scheduled_departure, scheduled_return=None):
    """Change who/what/when of a scheduled trip. Returns (trip, before) for auditing."""
    _check_scope(user, vehicle, driver)
    with transaction.atomic():
        vehicle = _lock_vehicle(vehicle.pk)
        trip = Trip.objects.select_for_update().get(pk=trip.pk)
        if trip.status != Trip.Status.SCHEDULED:
            raise serializers.ValidationError('Only scheduled trips can be rescheduled.')
        before = {'vehicle': trip.vehicle.plate_number, 'driver': trip.driver.full_name,
                  'scheduled_departure': trip.scheduled_departure.isoformat(),
                  'scheduled_return': trip.scheduled_return.isoformat() if trip.scheduled_return else None}
        _check_booking(vehicle, driver, scheduled_departure, scheduled_return, exclude=trip.pk)
        trip.vehicle, trip.driver = vehicle, driver
        trip.scheduled_departure, trip.scheduled_return = scheduled_departure, scheduled_return
        trip.save()
    return trip, before


def dispatch_scheduled(trip, *, odometer_start, departed_at=None):
    """The vehicle leaves on a scheduled trip. Only on the scheduled day; the odometer is read now."""
    departed_at = departed_at or timezone.now()
    if departed_at > timezone.now() + timedelta(minutes=5):
        _fail('departed_at', 'Departure time cannot be in the future.')
    with transaction.atomic():
        vehicle = _lock_vehicle(trip.vehicle_id)
        trip = Trip.objects.select_for_update().select_related('driver').get(pk=trip.pk)
        if trip.status != Trip.Status.SCHEDULED:
            raise serializers.ValidationError(f'Only scheduled trips can be dispatched this way (this one is {trip.get_status_display().lower()}).')
        day = timezone.localtime(trip.scheduled_departure).date()
        today = timezone.localdate()
        if day != today:
            msg = (f'This trip is scheduled for {day:%b %d, %Y}. It can only be dispatched on that day.' if day > today
                   else f'This trip was scheduled for {day:%b %d, %Y} and was missed. Reschedule or cancel it.')
            raise serializers.ValidationError(msg)
        if timezone.localtime(departed_at).date() != today:
            _fail('departed_at', 'The departure must be today.')
        _check_departure(vehicle, trip.driver, departed_at, odometer_start, exclude=trip.pk)
        trip.status, trip.departed_at, trip.odometer_start = Trip.Status.DISPATCHED, departed_at, odometer_start
        trip.save()
        _mark_in_use(vehicle)
    return trip


# ---------------------------------------------------------------- dispatch / complete / cancel

def dispatch(*, user, vehicle, driver, departed_at, odometer_start, ticket_number='', **fields):
    """Dispatch immediately, without a prior booking."""
    _check_scope(user, vehicle, driver)
    ticket = _check_ticket(ticket_number)
    with transaction.atomic():
        vehicle = _lock_vehicle(vehicle.pk)
        _check_departure(vehicle, driver, departed_at, odometer_start)
        trip = Trip.objects.create(
            ticket_number=ticket or f'PENDING-{uuid.uuid4().hex}', vehicle=vehicle, driver=driver,
            departed_at=departed_at, odometer_start=odometer_start, created_by=user, **fields)
        if not ticket:
            _auto_number(trip, departed_at)
        _mark_in_use(vehicle)
    return trip


def complete(trip, *, returned_at, odometer_end, remarks=None):
    """Close a dispatched trip. Returns (trip, previous_vehicle_odometer)."""
    if returned_at > timezone.now():
        _fail('returned_at', 'Return time cannot be in the future.')
    with transaction.atomic():
        vehicle = _lock_vehicle(trip.vehicle_id)
        trip = Trip.objects.select_for_update().get(pk=trip.pk)
        if trip.status != Trip.Status.DISPATCHED:
            raise serializers.ValidationError(f'Only dispatched trips can be completed (this one is {trip.get_status_display().lower()}).')
        if returned_at < trip.departed_at:
            _fail('returned_at', 'Return time cannot be before the departure time.')
        if odometer_end < trip.odometer_start:
            _fail('odometer_end', f'Ending odometer cannot be below the starting reading ({trip.odometer_start:,} km).')
        if odometer_end < vehicle.current_odometer:
            _fail('odometer_end', f'The vehicle odometer is already at {vehicle.current_odometer:,} km. '
                                  'Ask a System Administrator for an authorized correction if that reading is wrong.')

        trip.returned_at, trip.odometer_end, trip.status = returned_at, odometer_end, Trip.Status.COMPLETED
        if remarks:
            trip.remarks = remarks
        trip.save()

        previous = vehicle.current_odometer
        vehicle.current_odometer = odometer_end
        if vehicle.status == Vehicle.Status.IN_USE:
            vehicle.status = Vehicle.Status.SERVICEABLE
        vehicle.save(update_fields=['current_odometer', 'status', 'updated_at'])
    trip.refresh_from_db()  # distance_km is a DB-generated column
    return trip, previous


def cancel(trip, *, reason):
    with transaction.atomic():
        vehicle = _lock_vehicle(trip.vehicle_id)
        trip = Trip.objects.select_for_update().get(pk=trip.pk)
        if trip.status not in (Trip.Status.SCHEDULED, Trip.Status.DISPATCHED):
            raise serializers.ValidationError(f'Only scheduled or dispatched trips can be cancelled (this one is {trip.get_status_display().lower()}).')
        was_out = trip.status == Trip.Status.DISPATCHED
        trip.status = Trip.Status.CANCELLED
        trip.remarks = f'{trip.remarks}\n\nCancelled: {reason}'.strip()
        trip.save(update_fields=['status', 'remarks', 'updated_at'])
        if was_out and vehicle.status == Vehicle.Status.IN_USE:
            vehicle.status = Vehicle.Status.SERVICEABLE
            vehicle.save(update_fields=['status', 'updated_at'])
    return trip
