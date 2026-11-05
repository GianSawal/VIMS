"""
Vehicle request rules: submit, approve, decline, cancel. Views only validate input, call these and audit.

Flow: PENDING -> APPROVED (a Fleet Administrator picks the vehicle, driver optional; a SCHEDULED trip is booked
through operations/trips.py, so every booking rule applies) / DECLINED (reason) / CANCELLED (by the requester,
while pending, or after approval as long as the trip has not left; the trip is cancelled with it).
After approval the request follows its trip (dispatched, completed).
"""
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from accounts.permissions import VIEW_ALL_OFFICES
from notifications.models import Notification
from notifications.services import notify, recipients_for_office

from . import trips as trip_service
from .models import RoutePlan, Trip, VehicleRequest

APPROVE = 'operations.approve_vehiclerequest'
ROUTE_FIELDS = [f.name for f in RoutePlan._meta.get_fields()]
S = VehicleRequest.Status


def _fail(field, msg):
    raise serializers.ValidationError({field: [msg]})


def _locked(req):
    return VehicleRequest.objects.select_for_update().select_related('requester', 'office').get(pk=req.pk)


def _tell_requester(req, title, message, event):
    notify([req.requester], type=Notification.Type.VEHICLE_REQUEST, title=title, message=message,
           dedupe_key=f'req:{req.pk}:{event}', related=req)


def submit(*, user, office, needed_at, return_at=None, **fields):
    if not user.has_perm(VIEW_ALL_OFFICES) and not user.offices.filter(pk=office.pk).exists():
        _fail('office', 'You can only request a vehicle for your own office.')
    if needed_at < timezone.now() - timedelta(minutes=5):
        _fail('needed_at', 'The date and time needed must be in the future.')
    if return_at and return_at < needed_at:
        _fail('return_at', 'Expected return cannot be before the departure.')
    with transaction.atomic():
        req = VehicleRequest.objects.create(
            reference_number=f'PENDING-{uuid.uuid4().hex}', requester=user, office=office,
            needed_at=needed_at, return_at=return_at, created_by=user, **fields)
        # VR-YYYY-NNNNN from the primary key: unique without a counter table or a race.
        req.reference_number = f'VR-{timezone.localtime(needed_at):%Y}-{req.pk:05d}'
        req.save(update_fields=['reference_number'])
    approvers = recipients_for_office(office).filter(pk__in=get_user_model().objects.with_perm(APPROVE, is_active=True))
    when = timezone.localtime(needed_at).strftime('%b %d, %Y %I:%M %p')
    notify(approvers, type=Notification.Type.VEHICLE_REQUEST, title=f'New vehicle request {req.reference_number}',
           message=f'{user.get_full_name() or user.username} ({office.code}) needs a vehicle on {when} to {req.destination}.',
           dedupe_key=f'req:{req.pk}:submitted', related=req)
    return req


def approve(req, *, user, vehicle, driver=None, note=''):
    """Book the trip and approve. Booking errors (vehicle taken, in the past...) come from the trip rules."""
    with transaction.atomic():
        req = _locked(req)
        if req.status != S.PENDING:
            raise serializers.ValidationError(f'Only pending requests can be approved (this one is {req.get_status_display().lower()}).')
        if vehicle.office_id != req.office_id:
            raise serializers.ValidationError({'vehicle': [f'Choose a vehicle of {req.office.code}, the requesting office.']})
        requester = req.requester.get_full_name() or req.requester.username
        trip = trip_service.schedule(
            user=user, vehicle=vehicle, driver=driver, scheduled_departure=req.needed_at,
            scheduled_return=req.return_at, requesting_office=req.office, passengers=req.passengers,
            origin=req.origin, destination=req.destination, purpose=req.purpose,
            remarks='\n\n'.join(filter(None, [f'Vehicle request {req.reference_number} by {requester}.', req.remarks])),
            **{f: getattr(req, f) for f in ROUTE_FIELDS})
        req.status, req.trip, req.decision_note = S.APPROVED, trip, note
        req.decided_by, req.decided_at = user, timezone.now()
        req.save()
    who = f' with driver {driver.full_name}' if driver else '; the driver will be assigned before departure'
    _tell_requester(req, f'Vehicle request {req.reference_number} approved',
                    f'{vehicle.plate_number} ({vehicle.make} {vehicle.model}) is booked for you{who}.', 'approved')
    return req


def decline(req, *, user, reason):
    with transaction.atomic():
        req = _locked(req)
        if req.status != S.PENDING:
            raise serializers.ValidationError(f'Only pending requests can be declined (this one is {req.get_status_display().lower()}).')
        req.status, req.decision_note = S.DECLINED, reason
        req.decided_by, req.decided_at = user, timezone.now()
        req.save()
    _tell_requester(req, f'Vehicle request {req.reference_number} declined', f'Reason: {reason}', 'declined')
    return req


def cancel(req, *, user, reason):
    """The requester withdraws. An approved request can be withdrawn until the vehicle leaves."""
    with transaction.atomic():
        req = _locked(req)
        if req.requester_id != user.pk:
            raise serializers.ValidationError('Only the requester can cancel this request.')
        if req.status == S.APPROVED:
            if req.trip.status != Trip.Status.SCHEDULED:
                raise serializers.ValidationError(f'The trip is already {req.trip.get_status_display().lower()} and can no longer be cancelled here.')
            trip_service.cancel(req.trip, reason=f'Vehicle request {req.reference_number} withdrawn by the requester: {reason}')
        elif req.status != S.PENDING:
            raise serializers.ValidationError(f'This request is already {req.get_status_display().lower()}.')
        req.status, req.decision_note = S.CANCELLED, reason
        req.save()
    return req


def trip_dispatched(trip):
    """Called after a booked trip leaves: tell the requester, if the trip came from a request."""
    req = VehicleRequest.objects.filter(trip=trip).select_related('requester').first()
    if req:
        driver = f' Driver: {trip.driver.full_name}.' if trip.driver else ''
        _tell_requester(req, f'Your vehicle has been dispatched ({req.reference_number})',
                        f'{trip.vehicle.plate_number} left on trip {trip.ticket_number}.{driver}', 'dispatched')
