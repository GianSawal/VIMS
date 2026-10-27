"""Phase 11: notification generation (idempotent, per-threshold), office/role targeting and the API."""
import io
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from fleet.models import Driver, VehicleDocument
from fleet.test_vehicles import as_role, make_vehicle
from maintenance.models import MaintenanceCategory, MaintenanceSchedule
from notifications.models import Notification
from notifications.services import generate

pytestmark = pytest.mark.django_db
today = timezone.localdate


@pytest.fixture(autouse=True)
def setup(settings):
    settings.DOCUMENT_ALERT_DAYS = [60, 30, 15, 7]
    settings.MAINTENANCE_DUE_SOON_DAYS = 30
    settings.MAINTENANCE_DUE_SOON_KM = 500
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


@pytest.fixture
def fo2():
    return Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')


def user_of(office):
    """A Field Office User scoped to one office (its only recipient, since no view_all_offices here)."""
    as_role('Field Office User', [office])  # creates the user + client
    from accounts.models import User
    return User.objects.get(username='Field_Office_User')


def test_document_alert_targets_office_and_is_idempotent(fo1, fo2):
    u1 = user_of(fo1)
    v = make_vehicle(fo1, 'DOC 1')
    VehicleDocument.objects.create(vehicle=v, document_type='LTO_REGISTRATION',
                                   expiry_date=today() + timedelta(days=10))  # band "15"
    assert generate() == 1
    n = Notification.objects.get(recipient=u1)
    assert n.type == Notification.Type.LTO_RENEWAL and n.dedupe_key == f'doc:{v.documents.first().pk}:15'
    # re-run: no duplicate (unique recipient+dedupe_key)
    assert generate() == 0 and Notification.objects.count() == 1


def test_new_band_raises_one_more_alert(fo1):
    user_of(fo1)
    v = make_vehicle(fo1, 'DOC 2')
    d = VehicleDocument.objects.create(vehicle=v, document_type='OR', expiry_date=today() + timedelta(days=15))
    generate()
    d.expiry_date = today() + timedelta(days=5)  # now band "7"
    d.save()
    assert generate() == 1 and Notification.objects.filter(object_id=d.pk).count() == 2


def test_license_and_maintenance(fo1):
    user_of(fo1)
    Driver.objects.create(full_name='Pedro', office=fo1, license_number='L1',
                          license_expiry_date=today() - timedelta(days=1))  # EXPIRED
    v = make_vehicle(fo1, 'MNT 1', current_odometer=10000)
    cat = MaintenanceCategory.objects.first() or MaintenanceCategory.objects.create(name='Oil change')
    MaintenanceSchedule.objects.create(vehicle=v, category=cat, interval_days=90,
                                       last_service_date=today() - timedelta(days=200))  # OVERDUE
    generate()
    types = set(Notification.objects.values_list('type', flat=True))
    assert Notification.Type.LICENSE_EXPIRY in types and Notification.Type.MAINTENANCE_OVERDUE in types


def test_api_own_only_and_actions(fo1, fo2):
    c1 = as_role('Field Office User', [fo1])
    v = make_vehicle(fo1, 'API 1')
    VehicleDocument.objects.create(vehicle=v, document_type='LTO_REGISTRATION', expiry_date=today() + timedelta(days=5))
    generate()

    assert c1.get('/api/notifications/unread-count/').json()['count'] == 1
    nid = c1.get('/api/notifications/').json()['results'][0]['id']

    assert c1.post(f'/api/notifications/{nid}/read/').json()['is_read'] is True
    assert c1.get('/api/notifications/unread-count/').json()['count'] == 0

    # a user from another office sees none of u1's notifications
    c2 = as_role('Viewer', [fo2])
    assert c2.get('/api/notifications/').json()['count'] == 0
    assert c2.post(f'/api/notifications/{nid}/read/').status_code == 404

    assert c1.post(f'/api/notifications/{nid}/dismiss/').status_code == 204
    assert c1.get('/api/notifications/').json()['count'] == 0  # dismissed hidden


def test_read_all(fo1):
    c1 = as_role('Field Office User', [fo1])
    v = make_vehicle(fo1, 'RA 1')
    for t in (5, 20):
        VehicleDocument.objects.create(vehicle=v, document_type='OTHER', expiry_date=today() + timedelta(days=t))
    generate()
    assert c1.post('/api/notifications/read-all/').json()['updated'] == 2
    assert c1.get('/api/notifications/unread-count/').json()['count'] == 0


def test_logged_out_is_401():
    from rest_framework.test import APIClient
    assert APIClient().get('/api/notifications/').status_code == 401
