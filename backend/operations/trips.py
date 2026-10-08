"""
Trip rules: dispatch, complete, cancel. One place, so the API and the Excel import can't bypass them.

Odometer: a trip starts at or above the vehicle's accepted odometer and, on completion, moves the vehicle's
odometer forward to the trip's ending reading. Lowering an odometer is only possible through the
authorized correction on the vehicle itself.
"""
import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from accounts.permissions import scope_to_offices
from fleet.models import Driver, Vehicle

from .models import Trip

# A vehicle in any other status (maintenance, repair, unserviceable, disposed) is not dispatched.
DISPATCHABLE = {Vehicle.Status.SERVICEABLE, Vehicle.Status.IN_USE}


def _fail(field, msg):
    raise serializers.ValidationError({field: msg})


def _lock_vehicle(pk):
    """Row lock: two requests can't both dispatch, complete or cancel trips of one vehicle at the same time."""
    return Vehicle.objects.select_for_update().get(pk=pk)


def dispatch(*, user, vehicle, driver, departed_at, odometer_start, ticket_number='', **fields):
    if not scope_to_offices(Vehicle.objects.filter(pk=vehicle.pk), user, 'office').exists():
        _fail('vehicle', 'You do not have access to this vehicle.')
    if not scope_to_offices(Driver.objects.filter(pk=driver.pk), user, 'office').exists():
        _fail('driver', 'You do not have access to this driver.')

    with transaction.atomic():
        vehicle = _lock_vehicle(vehicle.pk)
        if vehicle.is_archived:
            _fail('vehicle', 'Archived vehicles cannot be dispatched.')
        if vehicle.status not in DISPATCHABLE:
            _fail('vehicle', f'This vehicle is {vehicle.get_status_display().lower()} and cannot be dispatched.')
        open_trip = vehicle.trips.filter(status=Trip.Status.DISPATCHED).first()
        if open_trip:
            _fail('vehicle', f'This vehicle is still out on trip {open_trip.ticket_number}. Complete or cancel it first.')

        if not driver.is_active:
            _fail('driver', 'This driver is inactive.')
        if driver.license_expiry_date < timezone.localtime(departed_at).date():
            _fail('driver', f"This driver's license expired on {driver.license_expiry_date:%b %d, %Y}.")
        busy = driver.trips.filter(status=Trip.Status.DISPATCHED).first()
        if busy:
            _fail('driver', f'This driver is still out on trip {busy.ticket_number}.')

        if odometer_start < vehicle.current_odometer:
            _fail('odometer_start', f'The vehicle odometer is already at {vehicle.current_odometer:,} km. '
                                    'The starting reading cannot be lower.')

        ticket = (ticket_number or '').strip().upper()
        if ticket and Trip.objects.filter(ticket_number=ticket).exists():
            _fail('ticket_number', 'A trip with this ticket number already exists.')

        trip = Trip.objects.create(
            ticket_number=ticket or f'PENDING-{uuid.uuid4().hex}', vehicle=vehicle, driver=driver,
            departed_at=departed_at, odometer_start=odometer_start, created_by=user, **fields)
        if not ticket:
            # Auto number from the primary key: unique without a counter table or a race.
            trip.ticket_number = f'TT-{timezone.localtime(departed_at):%Y}-{trip.pk:05d}'
            trip.save(update_fields=['ticket_number'])

        if vehicle.status == Vehicle.Status.SERVICEABLE:
            vehicle.status = Vehicle.Status.IN_USE
            vehicle.save(update_fields=['status', 'updated_at'])
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
        if trip.status != Trip.Status.DISPATCHED:
            raise serializers.ValidationError(f'Only dispatched trips can be cancelled (this one is {trip.get_status_display().lower()}).')
        trip.status = Trip.Status.CANCELLED
        trip.remarks = f'{trip.remarks}\n\nCancelled: {reason}'.strip()
        trip.save(update_fields=['status', 'remarks', 'updated_at'])
        if vehicle.status == Vehicle.Status.IN_USE:
            vehicle.status = Vehicle.Status.SERVICEABLE
            vehicle.save(update_fields=['status', 'updated_at'])
    return trip
