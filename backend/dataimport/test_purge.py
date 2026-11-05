"""Deleting test data: System Administrator only, explicit confirmation, vehicles and drivers survive, audited."""
import pytest

from accounts.test_auth import client_for
from audit.models import AuditLog
from dataimport.test_export import records, user  # noqa: F401 (fixture)
from fleet.models import Driver, Vehicle
from maintenance.models import MaintenanceRecord
from operations.models import FuelRecord, RFIDAccount, TollTransaction, Trip

pytestmark = pytest.mark.django_db


def test_only_the_system_administrator_may_purge(records):
    fleet = client_for(user('fleet', 'Fleet Administrator'))
    assert fleet.get('/api/admin/purge/').status_code == 403
    assert fleet.post('/api/admin/purge/', {'groups': ['trips'], 'confirm': 'DELETE'}, format='json').status_code == 403
    assert Trip.objects.exists()


def test_purge_needs_confirmation_and_keeps_vehicles_and_drivers(records):
    admin = client_for(user('admin', 'System Administrator'))
    counts = {g['key']: g['count'] for g in admin.get('/api/admin/purge/').data}
    assert counts['trips'] and counts['fuel'] and counts['maintenance'] and counts['odometers']
    assert admin.post('/api/admin/purge/', {'groups': ['trips']}, format='json').status_code == 400
    assert admin.post('/api/admin/purge/', {'groups': ['bogus'], 'confirm': 'DELETE'}, format='json').status_code == 400
    assert Trip.objects.exists()

    vehicles, drivers = Vehicle.objects.count(), Driver.objects.count()
    r = admin.post('/api/admin/purge/', {'groups': ['trips', 'fuel', 'tolls', 'maintenance', 'odometers'],
                                         'confirm': 'DELETE'}, format='json')
    assert r.status_code == 200, r.data
    assert not (Trip.objects.exists() or FuelRecord.objects.exists() or TollTransaction.objects.exists()
                or MaintenanceRecord.objects.exists())
    assert RFIDAccount.objects.exists()  # 'rfid' not chosen
    assert (Vehicle.objects.count(), Driver.objects.count()) == (vehicles, drivers)
    assert not Vehicle.objects.exclude(current_odometer=0).exists()
    log = AuditLog.objects.get(action='purge')
    assert log.username == 'admin' and log.changes['deleted']['operations.Trip']
