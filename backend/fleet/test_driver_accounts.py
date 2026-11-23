"""Driver logins: created by the System Administrator, role Driver, own trips only (see and record the return)."""
import io

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from accounts.models import Office, User
from audit.models import AuditLog
from fleet.driver_accounts import username_for
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle
from operations.test_trips import complete, dispatch

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def setup(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


def login(username, password):
    c = APIClient()
    assert c.login(username=username, password=password)
    return c


def test_username_from_employee_number_or_name(fo1):
    assert username_for(make_driver(fo1, 'Gilbert G. Gomez', 'L-1', employee_number='2021-0042')) == '2021-0042'
    assert username_for(make_driver(fo1, 'GILBERT G. GOMEZ JR.', 'L-2')) == 'ggomez'
    User.objects.create_user('ggomez')
    assert username_for(make_driver(fo1, 'Gina Gomez', 'L-3')) == 'ggomez2'


def test_bulk_creates_one_login_per_active_driver_without_one(fo1):
    pedro = make_driver(fo1, 'Pedro Penduko', 'L-1')
    make_driver(fo1, 'Old Driver', 'L-2', is_active=False)
    admin = as_role('System Administrator')
    assert as_role('Fleet Administrator').post('/api/drivers/create-accounts/').status_code == 403  # no add_user

    r = admin.post('/api/drivers/create-accounts/')
    assert r.status_code == 201 and r['Cache-Control'] == 'no-store'
    [made] = r.json()['created']
    assert made['username'] == 'ppenduko' and len(made['password']) == 10
    pedro.refresh_from_db()
    u = pedro.user
    assert u.must_change_password and list(u.groups.values_list('name', flat=True)) == ['Driver']
    assert list(u.offices.all()) == [fo1] and (u.first_name, u.last_name) == ('Pedro', 'Penduko')
    log = AuditLog.objects.get(action='create', entity_type='accounts.User')
    assert made['password'] not in str(log.changes) + log.description

    assert admin.post('/api/drivers/create-accounts/').json() == {'created': []}  # nothing left to do
    r = admin.post(f'/api/drivers/{pedro.pk}/account/')
    assert r.status_code == 400 and 'already has an account' in str(r.json())
    assert admin.get(f'/api/drivers/{pedro.pk}/').json()['account_username'] == 'ppenduko'


def test_driver_sees_and_returns_only_own_trips(fo1):
    pedro, juan = make_driver(fo1, 'Pedro Penduko', 'L-1'), make_driver(fo1, 'Juan Cruz', 'L-2')
    staff = as_role('Field Office User', [fo1])
    mine = dispatch(staff, make_vehicle(fo1, 'TRP 1', current_odometer=100), pedro).json()
    other = dispatch(staff, make_vehicle(fo1, 'TRP 2', current_odometer=100), juan).json()

    made = as_role('System Administrator').post(f'/api/drivers/{pedro.pk}/account/').json()
    c = login(made['username'], made['password'])
    assert c.get('/api/trips/').status_code == 403  # must change the temporary password first
    User.objects.filter(username=made['username']).update(must_change_password=False)

    assert [t['id'] for t in c.get('/api/trips/').json()['results']] == [mine['id']]
    assert c.get('/api/trips/summary/').json()['total'] == 1
    assert c.get(f"/api/trips/{other['id']}/").status_code == 404
    assert complete(c, other['id'], 150).status_code == 404
    assert c.post(f"/api/trips/{mine['id']}/cancel/", {'reason': 'x'}, format='json').status_code == 403
    assert c.patch(f"/api/trips/{mine['id']}/", {'remarks': 'x'}, format='json').status_code == 403
    assert c.get('/api/vehicles/').status_code == 403 and c.get('/api/drivers/').status_code == 403
    r = complete(c, mine['id'], 150)
    assert r.status_code == 200 and r.json()['status'] == 'COMPLETED'


def test_deactivating_the_driver_disables_the_login(fo1):
    pedro = make_driver(fo1, 'Pedro Penduko', 'L-1')
    admin = as_role('System Administrator')
    admin.post(f'/api/drivers/{pedro.pk}/account/')
    assert admin.patch(f'/api/drivers/{pedro.pk}/', {'is_active': False}, format='json').status_code == 200
    pedro.refresh_from_db()
    assert not pedro.user.is_active
    admin.patch(f'/api/drivers/{pedro.pk}/', {'is_active': True}, format='json')
    pedro.user.refresh_from_db()
    assert pedro.user.is_active


def test_admin_can_rename_a_driver_login(fo1):
    pedro = make_driver(fo1, 'Pedro Penduko', 'L-1')
    admin = as_role('System Administrator')
    made = admin.post(f'/api/drivers/{pedro.pk}/account/').json()
    User.objects.create_user('taken')
    account = admin.get(f'/api/drivers/{pedro.pk}/').json()['account_id']

    r = admin.patch(f'/api/users/{account}/', {'username': 'TAKEN'}, format='json')
    assert r.status_code == 400 and 'already taken' in str(r.json())
    r = admin.patch(f'/api/users/{account}/', {'username': 'pedro.p'}, format='json')
    assert r.status_code == 200
    assert admin.get(f'/api/drivers/{pedro.pk}/').json()['account_username'] == 'pedro.p'
    log = AuditLog.objects.filter(action='update', entity_type='accounts.User').latest('id')
    assert log.changes['username'] == ['ppenduko', 'pedro.p']
    login('pedro.p', made['password'])  # same password, new name
    assert as_role('Fleet Administrator').patch(f'/api/users/{account}/', {'username': 'x'}, format='json').status_code == 403
