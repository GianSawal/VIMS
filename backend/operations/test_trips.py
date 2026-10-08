"""Phase 6: trips. Dispatch/complete/cancel rules, odometer flow, scoping."""
import io
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from audit.models import AuditLog
from fleet.models import Vehicle
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle
from operations.models import Trip

pytestmark = pytest.mark.django_db
NOW = timezone.now()
ago = lambda hours: (NOW - timedelta(hours=hours)).isoformat()


@pytest.fixture(autouse=True)
def setup(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


@pytest.fixture
def fo2():
    return Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')


@pytest.fixture
def vehicle(fo1):
    return make_vehicle(fo1, 'TRP 1', current_odometer=10000)


@pytest.fixture
def driver(fo1):
    return make_driver(fo1, 'Pedro', 'L-1')


def body(vehicle, driver, **kw):
    return {'vehicle': vehicle.pk, 'driver': driver.pk, 'origin': 'Regional Office', 'destination': 'Field Office 1',
            'purpose': 'Monitoring', 'departed_at': ago(5), 'odometer_start': vehicle.current_odometer, **kw}


def dispatch(c, vehicle, driver, **kw):
    return c.post('/api/trips/', body(vehicle, driver, **kw), format='json')


def complete(c, trip_id, end, hours=1, **kw):
    return c.post(f'/api/trips/{trip_id}/complete/', {'returned_at': ago(hours), 'odometer_end': end, **kw}, format='json')


def test_full_trip_moves_vehicle_odometer_and_status(vehicle, driver):
    c = as_role('Field Office User', [vehicle.office])
    r = dispatch(c, vehicle, driver)
    assert r.status_code == 201, r.json()
    t = r.json()
    assert t['ticket_number'] == f'TT-{timezone.localtime(NOW):%Y}-{t["id"]:05d}'
    assert t['status'] == 'DISPATCHED' and t['distance_km'] is None
    vehicle.refresh_from_db()
    assert vehicle.status == 'IN_USE'

    r = complete(c, t['id'], 10150)
    assert r.status_code == 200, r.json()
    assert r.json()['status'] == 'COMPLETED' and r.json()['distance_km'] == 150
    vehicle.refresh_from_db()
    assert vehicle.current_odometer == 10150 and vehicle.status == 'SERVICEABLE'
    log = AuditLog.objects.get(action='odometer_update')
    assert log.entity_id == str(vehicle.pk) and log.changes == {'current_odometer': ['10000', '10150']}
    assert {'trip_dispatch', 'trip_complete'} <= set(AuditLog.objects.values_list('action', flat=True))


def test_manual_ticket_normalized_and_unique(vehicle, driver, fo1):
    c = as_role('Fleet Administrator')
    assert dispatch(c, vehicle, driver, ticket_number=' tt-001 ').json()['ticket_number'] == 'TT-001'
    v2, d2 = make_vehicle(fo1, 'TRP 2'), make_driver(fo1, 'Juan', 'L-2')
    r = dispatch(c, v2, d2, ticket_number='tt-001')
    assert r.status_code == 400 and 'ticket_number' in r.json()


@pytest.mark.parametrize('status', ['UNDER_MAINTENANCE', 'FOR_REPAIR', 'UNSERVICEABLE', 'DISPOSED'])
def test_unavailable_vehicle_cannot_be_dispatched(fo1, driver, status):
    v = make_vehicle(fo1, 'BAD 1', status=status)
    r = dispatch(as_role('Fleet Administrator'), v, driver)
    assert r.status_code == 400 and 'vehicle' in r.json()


def test_archived_vehicle_cannot_be_dispatched(fo1, driver):
    v = make_vehicle(fo1, 'ARC 1', is_archived=True)
    assert dispatch(as_role('Fleet Administrator'), v, driver).status_code == 400


def test_vehicle_and_driver_cannot_be_on_two_open_trips(vehicle, driver, fo1):
    c = as_role('Fleet Administrator')
    assert dispatch(c, vehicle, driver).status_code == 201
    r = dispatch(c, vehicle, make_driver(fo1, 'Other', 'L-9'))
    assert r.status_code == 400 and 'still out on trip' in str(r.json())
    r = dispatch(c, make_vehicle(fo1, 'TRP 3'), driver)
    assert r.status_code == 400 and 'driver' in r.json()


def test_driver_must_be_active_and_licensed(vehicle, fo1):
    c = as_role('Fleet Administrator')
    assert 'driver' in dispatch(c, vehicle, make_driver(fo1, 'Off', 'L-2', is_active=False)).json()
    assert 'expired' in str(dispatch(c, vehicle, make_driver(fo1, 'Exp', 'L-3', days=-2)).json())


def test_odometer_cannot_contradict_history(vehicle, driver):
    c = as_role('Fleet Administrator')
    r = dispatch(c, vehicle, driver, odometer_start=9999)
    assert r.status_code == 400 and 'odometer_start' in r.json()

    t = dispatch(c, vehicle, driver).json()
    assert 'odometer_end' in complete(c, t['id'], 9990).json()        # below start
    Vehicle.objects.filter(pk=vehicle.pk).update(current_odometer=10500)  # e.g. an authorized correction meanwhile
    assert 'odometer_end' in complete(c, t['id'], 10200).json()       # below the vehicle's accepted reading
    assert complete(c, t['id'], 10600).status_code == 200


def test_return_time_rules_and_single_completion(vehicle, driver):
    c = as_role('Fleet Administrator')
    t = dispatch(c, vehicle, driver, departed_at=ago(5)).json()
    assert 'returned_at' in complete(c, t['id'], 10100, hours=6).json()   # before departure
    assert 'returned_at' in complete(c, t['id'], 10100, hours=-2).json()  # in the future
    assert complete(c, t['id'], 10100).status_code == 200
    assert complete(c, t['id'], 10200).status_code == 400                 # already completed


def test_cancel_frees_vehicle_without_touching_odometer(vehicle, driver):
    c = as_role('Fleet Administrator')
    t = dispatch(c, vehicle, driver).json()
    assert c.post(f'/api/trips/{t["id"]}/cancel/', {}, format='json').status_code == 400  # reason required
    r = c.post(f'/api/trips/{t["id"]}/cancel/', {'reason': 'Meeting moved'}, format='json')
    assert r.status_code == 200 and r.json()['status'] == 'CANCELLED' and 'Meeting moved' in r.json()['remarks']
    vehicle.refresh_from_db()
    assert vehicle.status == 'SERVICEABLE' and vehicle.current_odometer == 10000
    assert c.post(f'/api/trips/{t["id"]}/cancel/', {'reason': 'x'}, format='json').status_code == 400
    assert dispatch(c, vehicle, driver).status_code == 201  # vehicle is free again


def test_patch_changes_only_descriptive_fields(vehicle, driver):
    c = as_role('Fleet Administrator')
    t = dispatch(c, vehicle, driver).json()
    r = c.patch(f'/api/trips/{t["id"]}/', {'destination': 'Provincial Office', 'odometer_start': 1,
                                           'status': 'COMPLETED'}, format='json')
    assert r.status_code == 200
    assert r.json()['destination'] == 'Provincial Office'
    assert r.json()['odometer_start'] == 10000 and r.json()['status'] == 'DISPATCHED'
    assert AuditLog.objects.get(action='update').changes == {'destination': ['Field Office 1', 'Provincial Office']}
    assert as_role('System Administrator').delete(f'/api/trips/{t["id"]}/').status_code == 405


def test_office_scoping(vehicle, driver, fo2):
    far_vehicle, far_driver = make_vehicle(fo2, 'FAR 1'), make_driver(fo2, 'Far', 'L-7')
    t_far = dispatch(as_role('Fleet Administrator'), far_vehicle, far_driver).json()
    c = as_role('Field Office User', [vehicle.office])
    assert dispatch(c, vehicle, driver).status_code == 201
    assert [t['plate_number'] for t in c.get('/api/trips/').json()['results']] == ['TRP 1']
    assert c.get(f'/api/trips/{t_far["id"]}/').status_code == 404
    assert complete(c, t_far['id'], 99999).status_code == 404
    assert 'vehicle' in dispatch(c, far_vehicle, driver).json()
    assert 'driver' in dispatch(c, make_vehicle(vehicle.office, 'TRP 4'), far_driver).json()


def test_viewer_is_read_only(vehicle, driver):
    t = dispatch(as_role('Fleet Administrator'), vehicle, driver).json()
    c = as_role('Viewer')
    assert c.get(f'/api/trips/{t["id"]}/').status_code == 200
    assert dispatch(c, vehicle, driver).status_code == 403
    assert complete(c, t['id'], 10100).status_code == 403
    assert c.post(f'/api/trips/{t["id"]}/cancel/', {'reason': 'x'}, format='json').status_code == 403


def test_filters_and_summary(vehicle, driver, fo1):
    c = as_role('Fleet Administrator')
    t1 = dispatch(c, vehicle, driver, departed_at=(NOW - timedelta(days=10)).isoformat()).json()
    complete(c, t1['id'], 10120, hours=200)
    v2, d2 = make_vehicle(fo1, 'TRP 2', current_odometer=500), make_driver(fo1, 'Juan', 'L-2')
    dispatch(c, v2, d2)
    assert c.get('/api/trips/?status=DISPATCHED').json()['count'] == 1
    assert c.get(f'/api/trips/?vehicle={vehicle.pk}').json()['count'] == 1
    since = (timezone.localdate() - timedelta(days=2)).isoformat()
    assert c.get(f'/api/trips/?date_from={since}').json()['results'][0]['plate_number'] == 'TRP 2'
    assert c.get('/api/trips/?search=juan').json()['count'] == 1
    assert c.get('/api/trips/summary/').json() == {
        'total': 2, 'distance_km': 120, 'by_status': {'DISPATCHED': 1, 'COMPLETED': 1, 'CANCELLED': 0}}


def test_trip_attachments(vehicle, driver):
    c = as_role('Field Office User', [vehicle.office])
    t = dispatch(c, vehicle, driver).json()
    r = c.post(f'/api/trips/{t["id"]}/attachments/', {'file': SimpleUploadedFile('ticket.pdf', b'%PDF-1.4 x')})
    assert r.status_code == 201, r.json()
    assert len(c.get(f'/api/trips/{t["id"]}/attachments/').json()) == 1
    assert as_role('Viewer').post(f'/api/trips/{t["id"]}/attachments/',
                                  {'file': SimpleUploadedFile('x.pdf', b'%PDF-1.4 x')}).status_code == 403
