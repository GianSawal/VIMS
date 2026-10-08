"""Phase 3: authentication, RBAC and office scoping."""
import io

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient

from accounts.models import Office, User
from audit.models import AuditLog

pytestmark = pytest.mark.django_db
PW = 'S3cure-pass-123'


@pytest.fixture(autouse=True)
def roles():
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def offices():
    ro = Office.objects.create(code='RO', name='Regional Office', office_type='REGIONAL')
    return ro, Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD', parent=ro), \
        Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD', parent=ro)


def make_user(username, role, offices=(), **extra):
    u = User.objects.create_user(username, password=PW, **extra)
    u.groups.add(Group.objects.get(name=role))
    u.offices.set(offices)
    return u


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def test_login_me_logout_with_csrf():
    make_user('admin1', 'System Administrator')
    api = APIClient(enforce_csrf_checks=True)
    api.get('/api/auth/csrf/')
    csrf = {'HTTP_X_CSRFTOKEN': api.cookies['csrftoken'].value}

    assert api.get('/api/auth/me/').status_code == 401  # 401 = logged out / session expired
    assert api.post('/api/auth/login/', {'username': 'admin1', 'password': 'wrong'}, **csrf).status_code == 400
    r = api.post('/api/auth/login/', {'username': 'admin1', 'password': PW}, **csrf)
    assert r.status_code == 200 and r.json()['role'] == 'System Administrator'
    assert r.json()['view_all_offices'] is True
    csrf = {'HTTP_X_CSRFTOKEN': api.cookies['csrftoken'].value}  # rotated on login
    assert api.post('/api/auth/logout/', **csrf).status_code == 204
    assert api.get('/api/auth/me/').status_code == 401
    assert list(AuditLog.objects.order_by('id').values_list('action', flat=True)) == ['login_failed', 'login', 'logout']


def test_inactive_user_cannot_login():
    make_user('gone', 'Viewer', is_active=False)
    assert APIClient().post('/api/auth/login/', {'username': 'gone', 'password': PW}).status_code == 400


def test_forced_password_change_blocks_api_until_changed(offices):
    u = make_user('newbie', 'Viewer', must_change_password=True)
    c = client_for(u)
    assert c.get('/api/offices/').status_code == 403
    assert c.get('/api/auth/me/').json()['must_change_password'] is True
    bad = c.post('/api/auth/change-password/', {'current_password': 'nope', 'new_password': 'An0ther-good-pass'})
    assert bad.status_code == 400 and 'current_password' in bad.json()
    weak = c.post('/api/auth/change-password/', {'current_password': PW, 'new_password': '123'})
    assert weak.status_code == 400 and 'new_password' in weak.json()
    ok = c.post('/api/auth/change-password/', {'current_password': PW, 'new_password': 'An0ther-good-pass'})
    assert ok.status_code == 200
    assert c.get('/api/offices/').status_code == 200


def test_only_admin_manages_users(offices):
    ro, fo1, _ = offices
    admin = make_user('admin1', 'System Administrator')
    for role in ('Fleet Administrator', 'Field Office User', 'Viewer'):
        assert client_for(make_user(role, role, [fo1])).get('/api/users/').status_code == 403

    c = client_for(admin)
    r = c.post('/api/users/', {'username': 'fo_user', 'password': PW, 'role': 'Field Office User',
                               'offices': [fo1.pk]}, format='json')
    assert r.status_code == 201, r.json()
    u = User.objects.get(username='fo_user')
    assert u.must_change_password and u.check_password(PW) and list(u.offices.all()) == [fo1]
    assert 'password' not in r.json()

    assert c.patch(f'/api/users/{u.pk}/', {'is_active': False}, format='json').status_code == 200
    assert c.patch(f'/api/users/{admin.pk}/', {'is_active': False}, format='json').status_code == 400
    assert c.post(f'/api/users/{u.pk}/reset-password/', {'new_password': 'Temp-pass-9876'}).status_code == 204
    assert c.delete(f'/api/users/{u.pk}/').status_code == 405
    assert AuditLog.objects.filter(entity_id=str(u.pk), action='update').first().changes == {'is_active': [True, False]}


def test_field_office_user_sees_only_own_offices(offices):
    ro, fo1, fo2 = offices
    c = client_for(make_user('fo', 'Field Office User', [fo1]))
    codes = [o['code'] for o in c.get('/api/offices/').json()['results']]
    assert codes == ['FO1']
    assert c.get(f'/api/offices/{fo2.pk}/').status_code == 404  # out of scope: hidden, not just forbidden
    assert c.patch(f'/api/offices/{fo1.pk}/', {'name': 'x'}, format='json').status_code == 403  # no change perm


def test_regional_roles_see_all_offices(offices):
    for role in ('System Administrator', 'Fleet Administrator', 'Viewer'):
        assert client_for(make_user(role, role)).get('/api/offices/').json()['count'] == 3


def test_viewer_is_read_only(offices):
    c = client_for(make_user('v', 'Viewer'))
    assert c.post('/api/offices/', {'code': 'X', 'name': 'X', 'office_type': 'FIELD'}).status_code == 403


def test_admin_manages_offices_without_delete(offices):
    c = client_for(make_user('admin1', 'System Administrator'))
    r = c.post('/api/offices/', {'code': ' fo3 ', 'name': 'Field Office 3', 'office_type': 'FIELD'})
    assert r.status_code == 201 and r.json()['code'] == 'FO3'
    assert c.patch(f'/api/offices/{r.json()["id"]}/', {'is_active': False}, format='json').status_code == 200
    assert c.delete(f'/api/offices/{r.json()["id"]}/').status_code == 405
