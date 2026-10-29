"""Phase 18: health check and the first-administrator command."""
import io
import re
from unittest import mock

import pytest
from django.core.management import CommandError, call_command
from django.db.utils import OperationalError
from rest_framework.test import APIClient

from accounts.models import User

pytestmark = pytest.mark.django_db


def test_health_ok_without_login(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    r = APIClient().get('/api/health/')
    assert r.status_code == 200 and r.json() == {'status': 'ok'}
    assert 'no-cache' in r['Cache-Control']


def test_health_reports_database_failure_without_details(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    with mock.patch('config.health.connection.cursor', side_effect=OperationalError('secret host db:3306')):
        r = APIClient().get('/api/health/')
    assert r.status_code == 503 and r.json() == {'status': 'error'}


def test_health_get_only():
    assert APIClient().post('/api/health/').status_code == 405


def test_create_admin_one_time_password():
    call_command('seed_reference', stdout=io.StringIO())
    out = io.StringIO()
    call_command('create_admin', 'admin', '--email', 'admin@example.gov.ph', stdout=out)
    password = re.search(r'login\): (\S+)', out.getvalue()).group(1)
    user = User.objects.get(username='admin')
    assert user.check_password(password) and user.must_change_password and user.is_staff
    assert not user.is_superuser and list(user.groups.values_list('name', flat=True)) == ['System Administrator']
    assert user.has_perm('audit.view_auditlog') and user.has_perm('accounts.view_all_offices')
    with pytest.raises(CommandError, match='already exists'):
        call_command('create_admin', 'ADMIN', stdout=io.StringIO())


def test_create_admin_needs_roles():
    with pytest.raises(CommandError, match='seed_reference'):
        call_command('create_admin', 'admin', stdout=io.StringIO())
