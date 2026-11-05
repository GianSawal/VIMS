"""Deleting a vehicle, driver or RFID account entered by mistake: System Administrator only, never with history."""
import io

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from audit.models import AuditLog
from fleet.models import Driver, Vehicle
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle
from operations.models import RFIDAccount, TollTransaction, Trip

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def seed():
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


def test_only_the_system_administrator_may_delete(fo1):
    v = make_vehicle(fo1, 'OOPS 1')
    assert as_role('Fleet Administrator').post(f'/api/vehicles/{v.pk}/remove/').status_code == 403
    assert Vehicle.objects.filter(pk=v.pk).exists()


def test_records_without_history_are_deleted_and_audited(fo1):
    admin = as_role('System Administrator')
    v, d = make_vehicle(fo1, 'OOPS 2'), make_driver(fo1, 'Mistake', 'L-OOPS')
    acc = RFIDAccount.objects.create(provider='EASYTRIP', account_number='EASY-12345678')
    for url in (f'/api/vehicles/{v.pk}/remove/', f'/api/drivers/{d.pk}/remove/', f'/api/rfid-accounts/{acc.pk}/remove/'):
        assert admin.post(url).status_code == 204, url
    assert not (Vehicle.objects.filter(pk=v.pk).exists() or Driver.objects.filter(pk=d.pk).exists() or RFIDAccount.objects.filter(pk=acc.pk).exists())
    logs = list(AuditLog.objects.filter(action='delete').values_list('description', flat=True))
    assert len(logs) == 3 and any('OOPS 2' in x for x in logs)
    assert not any('12345678' in x for x in logs) and any('5678' in x for x in logs)  # account number masked


def test_records_with_history_are_refused(fo1):
    admin = as_role('System Administrator')
    v, d = make_vehicle(fo1, 'USED 1'), make_driver(fo1, 'Used Driver', 'L-USED')
    Trip.objects.create(ticket_number='T-USED', status='COMPLETED', vehicle=v, driver=d, origin='RO', destination='X', purpose='x',
                        departed_at=timezone.now(), returned_at=timezone.now(), odometer_start=0, odometer_end=10)
    acc = RFIDAccount.objects.create(provider='EASYTRIP', account_number='E-USED', vehicle=v)
    TollTransaction.objects.create(account=acc, vehicle=v, transacted_at=timezone.now(), credit=100, description='Reload')
    r = admin.post(f'/api/vehicles/{v.pk}/remove/')
    assert r.status_code == 400 and 'Archive' in r.json()[0]
    assert 'trips' in r.json()[0]
    assert admin.post(f'/api/drivers/{d.pk}/remove/').status_code == 400
    assert admin.post(f'/api/rfid-accounts/{acc.pk}/remove/').status_code == 400
    assert Vehicle.objects.filter(pk=v.pk).exists() and Driver.objects.filter(pk=d.pk).exists() and RFIDAccount.objects.filter(pk=acc.pk).exists()
    assert not AuditLog.objects.filter(action='delete').exists()  # the audit entry rolled back with the refused delete
