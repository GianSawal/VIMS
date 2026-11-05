"""Phase 17A: vehicle requests (requester portal) and their approval into scheduled trips."""
import io
from datetime import datetime, time, timedelta

import pytest
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Office, User
from audit.models import AuditLog
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle
from notifications.models import Notification
from operations.models import Trip, VehicleRequest

pytestmark = pytest.mark.django_db
TODAY = timezone.localdate()


def at(day_offset, hour):
    return timezone.make_aware(datetime.combine(TODAY + timedelta(days=day_offset), time(hour)))


@pytest.fixture(autouse=True)
def seed():
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


@pytest.fixture
def fo2():
    return Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')


def requester(name, office):
    u = User.objects.create_user(name, first_name=name.title())
    u.groups.add(Group.objects.get(name='Requester'))
    u.offices.set([office])
    c = APIClient()
    c.force_login(u)  # a session, so /media/ (a plain Django view) sees the user too
    return u, c


def submit(c, office, start=None, end=None, **kw):
    start = start or at(2, 8)
    return c.post('/api/vehicle-requests/', {
        'office': office.pk, 'purpose': 'Labor inspection', 'origin': 'RO', 'destination': 'Tarlac',
        'needed_at': start.isoformat(), 'return_at': end.isoformat() if end else None, **kw}, format='json')


def test_requester_submits_and_sees_only_own(fo1, fo2):
    ana, c = requester('ana', fo1)
    _, other = requester('ben', fo1)
    admin = as_role('Fleet Administrator')
    r = submit(c, fo1, at(2, 8), at(2, 17), passengers='Ana, Carlo')
    assert r.status_code == 201, r.json()
    req = r.json()
    assert req['status'] == 'PENDING' and req['progress'] == 'PENDING' and req['trip'] is None
    assert req['reference_number'] == f'VR-{at(2, 8):%Y}-{req["id"]:05d}'
    assert AuditLog.objects.filter(action='request_submit').exists()
    # Fleet admins (approvers) are told; the requester is not.
    assert Notification.objects.filter(recipient__username='Fleet_Administrator', type='VEHICLE_REQUEST').exists()
    assert not Notification.objects.filter(recipient=ana).exists()

    assert other.get(f'/api/vehicle-requests/{req["id"]}/').status_code == 404
    assert other.get('/api/vehicle-requests/').json()['count'] == 0
    assert admin.get('/api/vehicle-requests/').json()['count'] == 1
    # Only for one's own office, in the future, return after departure.
    assert 'office' in submit(c, fo2).json()
    assert 'needed_at' in submit(c, fo1, at(-1, 8)).json()
    assert 'return_at' in submit(c, fo1, at(2, 8), at(2, 7)).json()


def test_requester_has_no_fleet_access(fo1):
    _, c = requester('ana', fo1)
    for path in ('/api/vehicles/', '/api/trips/', '/api/drivers/', '/api/fuel-records/', '/api/rfid-accounts/'):
        assert c.get(path).status_code == 403, path
    assert set(c.get('/api/dashboard/').json()) == {'month', 'office', 'today', 'activity'}  # no fleet sections
    req = submit(c, fo1).json()
    assert c.post(f'/api/vehicle-requests/{req["id"]}/approve/', {'vehicle': 1}, format='json').status_code == 403
    assert c.post(f'/api/vehicle-requests/{req["id"]}/decline/', {'reason': 'x'}, format='json').status_code == 403


def test_approve_books_a_scheduled_trip_driver_optional(fo1):
    ana, c = requester('ana', fo1)
    admin = as_role('Fleet Administrator')
    v = make_vehicle(fo1, 'REQ 1', current_odometer=1000)
    req = submit(c, fo1, at(3, 8), at(3, 17), passengers='Ana', remarks='Bring the banner',
                 destination_lat='15.4', destination_lng='120.6', route_geometry=[[15.0, 120.6], [15.4, 120.6]]).json()

    r = admin.post(f'/api/vehicle-requests/{req["id"]}/approve/', {'vehicle': v.pk, 'note': 'OK'}, format='json')
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body['status'] == 'APPROVED' and body['progress'] == 'APPROVED' and body['decided_by_name']
    trip = Trip.objects.get(pk=body['trip']['id'])
    assert trip.status == 'SCHEDULED' and trip.driver is None and trip.vehicle == v
    assert trip.scheduled_departure == at(3, 8) and trip.requesting_office == fo1 and trip.passengers == 'Ana'
    assert trip.route_geometry == [[15.0, 120.6], [15.4, 120.6]] and str(trip.destination_lat) == '15.400000'
    assert req['reference_number'] in trip.remarks and 'Bring the banner' in trip.remarks
    assert Notification.objects.filter(recipient=ana, dedupe_key=f'req:{req["id"]}:approved').exists()
    # The requester sees what was booked, never the rest of the fleet.
    seen = c.get(f'/api/vehicle-requests/{req["id"]}/').json()['trip']
    assert seen['plate_number'] == 'REQ 1' and seen['driver_name'] is None
    # Already decided.
    assert admin.post(f'/api/vehicle-requests/{req["id"]}/approve/', {'vehicle': v.pk}, format='json').status_code == 400


def test_approve_follows_booking_rules(fo1):
    _, c = requester('ana', fo1)
    admin = as_role('Fleet Administrator')
    v = make_vehicle(fo1, 'REQ 1')
    first = submit(c, fo1, at(3, 8), at(3, 12)).json()
    second = submit(c, fo1, at(3, 10), at(3, 15)).json()
    assert admin.post(f'/api/vehicle-requests/{first["id"]}/approve/', {'vehicle': v.pk}, format='json').status_code == 200
    r = admin.post(f'/api/vehicle-requests/{second["id"]}/approve/', {'vehicle': v.pk}, format='json')
    assert r.status_code == 400 and 'already booked' in r.json()['vehicle'][0]
    assert VehicleRequest.objects.get(pk=second['id']).status == 'PENDING'  # nothing half-saved
    bad = make_vehicle(fo1, 'BAD 1', status='UNSERVICEABLE')
    assert 'vehicle' in admin.post(f'/api/vehicle-requests/{second["id"]}/approve/', {'vehicle': bad.pk}, format='json').json()


def test_approve_only_with_a_vehicle_of_the_requesting_office(fo1, fo2):
    _, c = requester('ana', fo1)
    admin = as_role('Fleet Administrator')
    req = submit(c, fo1).json()
    other = make_vehicle(fo2, 'FAR 1')
    r = admin.post(f'/api/vehicle-requests/{req["id"]}/approve/', {'vehicle': other.pk}, format='json')
    assert r.status_code == 400 and 'requesting office' in r.json()['vehicle'][0]
    assert VehicleRequest.objects.get(pk=req['id']).status == 'PENDING'
    assert admin.post(f'/api/vehicle-requests/{req["id"]}/approve/', {'vehicle': make_vehicle(fo1, 'NEAR 1').pk}, format='json').status_code == 200


def test_approve_only_with_a_driver_of_the_requesting_office(fo1, fo2):
    _, c = requester('ana', fo1)
    admin = as_role('Fleet Administrator')
    req = submit(c, fo1).json()
    vehicle = make_vehicle(fo1, 'NEAR 1')
    r = admin.post(f'/api/vehicle-requests/{req["id"]}/approve/',
                   {'vehicle': vehicle.pk, 'driver': make_driver(fo2, 'Far', 'L-8').pk}, format='json')
    assert r.status_code == 400 and 'requesting office' in r.json()['driver'][0]
    assert VehicleRequest.objects.get(pk=req['id']).status == 'PENDING'
    r = admin.post(f'/api/vehicle-requests/{req["id"]}/approve/',
                   {'vehicle': vehicle.pk, 'driver': make_driver(fo1, 'Near', 'L-9').pk}, format='json')
    assert r.status_code == 200


def test_decline_needs_reason_and_notifies(fo1):
    ana, c = requester('ana', fo1)
    admin = as_role('Fleet Administrator')
    req = submit(c, fo1).json()
    assert 'reason' in admin.post(f'/api/vehicle-requests/{req["id"]}/decline/', {}, format='json').json()
    r = admin.post(f'/api/vehicle-requests/{req["id"]}/decline/', {'reason': 'No vehicle that day'}, format='json')
    assert r.status_code == 200 and r.json()['status'] == 'DECLINED' and r.json()['decision_note'] == 'No vehicle that day'
    assert Notification.objects.filter(recipient=ana, dedupe_key=f'req:{req["id"]}:declined').exists()
    assert c.post(f'/api/vehicle-requests/{req["id"]}/cancel/', {'reason': 'x'}, format='json').status_code == 400


def test_requester_cancels_pending_or_approved_until_dispatch(fo1):
    _, c = requester('ana', fo1)
    _, ben = requester('ben', fo1)
    admin = as_role('Fleet Administrator')
    pending = submit(c, fo1).json()
    assert ben.post(f'/api/vehicle-requests/{pending["id"]}/cancel/', {'reason': 'x'}, format='json').status_code == 404
    # An approver can see it but cannot withdraw someone else's request.
    assert admin.post(f'/api/vehicle-requests/{pending["id"]}/cancel/', {'reason': 'x'}, format='json').status_code == 400
    r = c.post(f'/api/vehicle-requests/{pending["id"]}/cancel/', {'reason': 'Meeting moved'}, format='json')
    assert r.status_code == 200 and r.json()['status'] == 'CANCELLED'

    v = make_vehicle(fo1, 'REQ 1')
    approved = submit(c, fo1, at(4, 8)).json()
    trip_id = admin.post(f'/api/vehicle-requests/{approved["id"]}/approve/', {'vehicle': v.pk}, format='json').json()['trip']['id']
    r = c.post(f'/api/vehicle-requests/{approved["id"]}/cancel/', {'reason': 'Not needed'}, format='json')
    assert r.status_code == 200 and r.json()['status'] == 'CANCELLED'
    assert Trip.objects.get(pk=trip_id).status == 'CANCELLED'


def test_progress_follows_trip_and_dispatch_notifies(fo1):
    ana, c = requester('ana', fo1)
    admin = as_role('Fleet Administrator')
    v, d = make_vehicle(fo1, 'REQ 1', current_odometer=1000), make_driver(fo1, 'Pedro', 'L-1')
    req = submit(c, fo1, at(2, 8)).json()
    trip_id = admin.post(f'/api/vehicle-requests/{req["id"]}/approve/', {'vehicle': v.pk}, format='json').json()['trip']['id']
    Trip.objects.filter(pk=trip_id).update(scheduled_departure=timezone.now() - timedelta(minutes=1))  # it is the day
    r = admin.post(f'/api/trips/{trip_id}/dispatch/', {'odometer_start': 1000, 'driver': d.pk}, format='json')
    assert r.status_code == 200, r.json()
    body = c.get(f'/api/vehicle-requests/{req["id"]}/').json()
    assert body['progress'] == 'DISPATCHED' and body['trip']['driver_name'] == 'Pedro'
    assert Notification.objects.filter(recipient=ana, dedupe_key=f'req:{req["id"]}:dispatched').exists()

    summary = c.get('/api/vehicle-requests/summary/').json()
    assert summary['total'] == 1 and summary['dispatched'] == 1 and summary['pending'] == 0
    assert c.get('/api/vehicle-requests/', {'progress': 'DISPATCHED'}).json()['count'] == 1
    assert c.get('/api/vehicle-requests/', {'progress': 'PENDING'}).json()['count'] == 0


def test_travel_order_attachment_is_private_to_the_request(fo1):
    _, c = requester('ana', fo1)
    _, ben = requester('ben', fo1)
    req = submit(c, fo1).json()
    up = c.post(f'/api/vehicle-requests/{req["id"]}/attachments/',
                {'file': SimpleUploadedFile('to.pdf', b'%PDF-1.4 travel order', content_type='application/pdf')},
                format='multipart')
    assert up.status_code == 201, up.json()
    url = up.json()['url']
    assert c.get(url).status_code == 200
    assert ben.get(url).status_code == 404  # same office, not his request
    approver = User.objects.create_user('approver')
    approver.groups.add(Group.objects.get(name='Fleet Administrator'))
    admin = APIClient()
    admin.force_login(approver)
    assert admin.get(url).status_code == 200
