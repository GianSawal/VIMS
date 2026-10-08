"""Phase 5: assignment rules. Reassigning must preserve history."""
import io
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from audit.models import AuditLog
from fleet.models import Driver, Vehicle, VehicleAssignment
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle

pytestmark = pytest.mark.django_db
TODAY = timezone.localdate()
day = lambda n: str(TODAY - timedelta(days=n))


@pytest.fixture(autouse=True)
def seed():
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


@pytest.fixture
def fo2():
    return Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')


@pytest.fixture
def vehicle(fo1):
    return make_vehicle(fo1, 'ASN 1')


def body(office, person='Maria Santos', driver=None, start=0, **kw):
    return {'office': office.pk, 'accountable_person': person, 'driver': driver.pk if driver else None,
            'start_date': day(start), **kw}


def assign(c, v, *a, **kw):
    return c.post(f'/api/vehicles/{v.pk}/assignments/', body(*a, **kw), format='json')


def test_first_assignment_shows_on_vehicle(vehicle, fo1):
    d = make_driver(fo1, 'Pedro')
    c = as_role('Fleet Administrator')
    r = assign(c, vehicle, fo1, driver=d, start=10)
    assert r.status_code == 201, r.json()
    assert r.json()['is_current'] and r.json()['driver_name'] == 'Pedro'
    cur = c.get(f'/api/vehicles/{vehicle.pk}/').json()['current_assignment']
    assert cur['accountable_person'] == 'Maria Santos' and cur['driver'] == 'Pedro'
    assert AuditLog.objects.get(action='assign').entity_id == str(vehicle.pk)


def test_reassign_preserves_history(vehicle, fo1, fo2):
    c = as_role('Fleet Administrator')
    d1, d2 = make_driver(fo1, 'Pedro', 'L-1'), make_driver(fo2, 'Juan', 'L-2')
    assert assign(c, vehicle, fo1, 'Maria Santos', d1, start=30).status_code == 201
    r = assign(c, vehicle, fo2, 'Ana Reyes', d2, start=5)
    assert r.status_code == 201

    rows = list(VehicleAssignment.objects.filter(vehicle=vehicle).order_by('start_date'))
    assert len(rows) == 2  # nothing overwritten
    old, new = rows
    assert (old.accountable_person, old.driver_id, str(old.end_date)) == ('Maria Santos', d1.pk, day(5))
    assert new.end_date is None and new.accountable_person == 'Ana Reyes' and new.office == fo2
    assert VehicleAssignment.objects.filter(vehicle=vehicle, end_date__isnull=True).count() == 1

    hist = c.get(f'/api/vehicles/{vehicle.pk}/assignments/').json()
    assert [(a['accountable_person'], a['is_current']) for a in hist['results']] == [('Ana Reyes', True), ('Maria Santos', False)]
    log = AuditLog.objects.get(action='reassign')
    assert log.changes['accountable_person'] == ['Maria Santos', 'Ana Reyes'] and log.changes['driver'] == ['Pedro', 'Juan']


def test_history_keeps_names_even_after_driver_renamed(vehicle, fo1):
    d = make_driver(fo1, 'Old Name')
    c = as_role('Fleet Administrator')
    assign(c, vehicle, fo1, driver=d)
    d.full_name = 'New Name'
    d.save()
    assert c.get(f'/api/vehicles/{vehicle.pk}/assignments/').json()['results'][0]['driver_name'] == 'Old Name'


def test_date_rules(vehicle, fo1):
    c = as_role('Fleet Administrator')
    assert assign(c, vehicle, fo1, start=-1).status_code == 400  # future
    assign(c, vehicle, fo1, start=10)
    assert 'start_date' in assign(c, vehicle, fo1, 'Other', start=20).json()  # before current began
    assert assign(c, vehicle, fo1, 'Same Day', start=10).status_code == 201  # same-day handover is fine
    assign(c, vehicle, fo1, 'Third', start=2)
    r = c.post(f'/api/vehicles/{vehicle.pk}/end-assignment/', {'end_date': day(1)}, format='json')
    assert r.status_code == 200
    # a new period that would overlap an earlier closed one is rejected
    assert 'overlaps' in str(assign(c, vehicle, fo1, 'Overlap', start=5).json())


def test_end_assignment(vehicle, fo1):
    c = as_role('Fleet Administrator')
    url = f'/api/vehicles/{vehicle.pk}/end-assignment/'
    assert c.post(url, {'end_date': day(0)}, format='json').status_code == 400  # nothing to end
    assign(c, vehicle, fo1, start=10)
    assert c.post(url, {'end_date': day(11)}, format='json').status_code == 400  # before it began
    assert c.post(url, {'end_date': day(-1)}, format='json').status_code == 400  # future
    r = c.post(url, {'end_date': day(3)}, format='json')
    assert r.status_code == 200 and r.json()['end_date'] == day(3) and not r.json()['is_current']
    assert c.get(f'/api/vehicles/{vehicle.pk}/').json()['current_assignment'] is None
    assert c.post(url, {'end_date': day(2)}, format='json').status_code == 400  # already ended
    assert AuditLog.objects.filter(action='end_assignment').count() == 1


def test_archived_and_disposed_vehicles_cannot_be_assigned(fo1):
    c = as_role('Fleet Administrator')
    arch = make_vehicle(fo1, 'ARC 1', is_archived=True)
    disp = make_vehicle(fo1, 'DSP 1', status='DISPOSED')
    assert assign(c, arch, fo1).status_code == 400
    assert assign(c, disp, fo1).status_code == 400


def test_driver_must_be_active_valid_and_in_scope(vehicle, fo1, fo2):
    c = as_role('Fleet Administrator')
    assert assign(c, vehicle, fo1, driver=make_driver(fo1, 'Off', 'L-1', is_active=False)).status_code == 400
    r = assign(c, vehicle, fo1, driver=make_driver(fo1, 'Expired', 'L-2', days=-5))
    assert r.status_code == 400 and 'expired' in str(r.json())
    # license valid today but expired by an earlier start date check: expires in 2 days, start today is fine
    assert assign(c, vehicle, fo1, driver=make_driver(fo1, 'Almost', 'L-3', days=2)).status_code == 201

    # a user limited to FO1 cannot use an FO2 driver, nor assign into FO2
    from django.contrib.auth.models import Permission
    scoped = as_role('Fleet Administrator', [fo1])
    u = scoped.handler._force_user
    u.groups.clear()
    u.user_permissions.add(*Permission.objects.filter(
        codename__in=['view_vehicle', 'view_vehicleassignment', 'add_vehicleassignment', 'change_vehicleassignment']))
    v2 = make_vehicle(fo1, 'ASN 2')
    assert assign(scoped, v2, fo1, driver=make_driver(fo2, 'Far', 'L-4')).status_code == 400
    assert assign(scoped, v2, fo2).status_code == 403
    assert assign(scoped, v2, fo1).status_code == 201


def test_permissions_and_scoping(vehicle, fo1, fo2):
    assert assign(as_role('Viewer'), vehicle, fo1).status_code == 403
    fo_user = as_role('Field Office User', [fo1])
    assert fo_user.get(f'/api/vehicles/{vehicle.pk}/assignments/').status_code == 200
    assert assign(fo_user, vehicle, fo1).status_code == 403
    assert fo_user.post(f'/api/vehicles/{vehicle.pk}/end-assignment/', {'end_date': day(0)}, format='json').status_code == 403
    theirs = make_vehicle(fo2, 'FAR 1')
    assert fo_user.get(f'/api/vehicles/{theirs.pk}/assignments/').status_code == 404


def test_missing_fields_rejected(vehicle, fo1):
    r = as_role('Fleet Administrator').post(f'/api/vehicles/{vehicle.pk}/assignments/',
                                            {'office': fo1.pk, 'accountable_person': '  '}, format='json')
    assert r.status_code == 400 and {'accountable_person', 'start_date'} <= set(r.json())


def test_driver_and_remarks_may_be_omitted(vehicle, fo1):
    c = as_role('Fleet Administrator')
    r = c.post(f'/api/vehicles/{vehicle.pk}/assignments/',
               {'office': fo1.pk, 'accountable_person': 'A', 'start_date': day(5)}, format='json')
    assert r.status_code == 201 and r.json()['driver'] is None and r.json()['driver_name'] == ''
    r = c.post(f'/api/vehicles/{vehicle.pk}/assignments/',
               {'office': fo1.pk, 'accountable_person': 'B', 'start_date': day(1)}, format='json')
    assert r.status_code == 201
