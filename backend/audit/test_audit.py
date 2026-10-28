"""Phase 14: critical changes are traceable (user, time, entity, before/after) and the log is read-only, admin-only."""
from datetime import timedelta

import pytest

from audit.models import AuditLog
from audit.services import log
from dashboard.test_dashboard import fleet, fo1, fo2, setup, today  # noqa: F401 (shared fixtures)
from fleet.models import VehicleDocument
from fleet.test_vehicles import as_role
from maintenance.models import MaintenanceRecord
from operations.models import FuelRecord

pytestmark = pytest.mark.django_db


def entry(model_label, pk, action='update'):
    return AuditLog.objects.get(entity_type=model_label, entity_id=str(pk), action=action)


def test_fuel_maintenance_and_document_edits_keep_before_and_after(fleet):
    c = as_role('Fleet Administrator')
    fuel = FuelRecord.objects.filter(vehicle=fleet['a']).first()
    FuelRecord.objects.filter(pk=fuel.pk).update(fuel_type=fleet['a'].fuel_type)  # fixture fill-up says diesel
    r = c.patch(f'/api/fuel-records/{fuel.pk}/', {'supplier': 'Petron Tarlac'}, format='json')
    assert r.status_code == 200, r.json()
    assert entry('operations.FuelRecord', fuel.pk).changes == {'supplier': ['', 'Petron Tarlac']}
    job = MaintenanceRecord.objects.get(description='Open job')
    assert c.patch(f'/api/maintenance/{job.pk}/', {'remarks': 'Waiting for parts'}, format='json').status_code == 200
    assert entry('maintenance.MaintenanceRecord', job.pk).changes == {'remarks': ['', 'Waiting for parts']}
    doc = VehicleDocument.objects.filter(vehicle=fleet['a']).first()
    assert c.patch(f'/api/documents/{doc.pk}/', {'remarks': 'Paid at LTO'}, format='json').status_code == 200
    e = entry('fleet.VehicleDocument', doc.pk)
    assert e.changes == {'remarks': ['', 'Paid at LTO']} and e.username and e.timestamp


def test_admin_reads_log_with_filters(fleet):
    c = as_role('System Administrator')
    fuel = FuelRecord.objects.filter(vehicle=fleet['a']).first()
    FuelRecord.objects.filter(pk=fuel.pk).update(fuel_type=fleet['a'].fuel_type)  # fixture fill-up says diesel
    c.patch(f'/api/fuel-records/{fuel.pk}/', {'supplier': 'Shell'}, format='json')
    r = c.get('/api/audit-logs/')
    assert r.status_code == 200 and r.json()['count'] >= 1
    row = c.get('/api/audit-logs/', {'entity_type': 'operations.FuelRecord', 'entity_id': fuel.pk}).json()['results'][0]
    assert row['action'] == 'update' and row['changes'] == {'supplier': ['', 'Shell']} and row['username']
    assert c.get(f'/api/audit-logs/{row["id"]}/').json()['description'].startswith('Updated fuel record')
    assert c.get('/api/audit-logs/', {'action': 'update', 'search': 'fuel'}).json()['count'] == 1
    assert c.get('/api/audit-logs/', {'date_from': (today() + timedelta(days=1)).isoformat()}).json()['count'] == 0
    assert c.get('/api/audit-logs/', {'date_to': today().isoformat()}).json()['count'] >= 1
    facets = c.get('/api/audit-logs/facets/').json()
    assert {'value': 'operations.FuelRecord', 'count': 1} in facets['entity_types']
    assert any(a['value'] == 'update' for a in facets['actions']) and facets['usernames']


@pytest.mark.parametrize('role', ['Fleet Administrator', 'Field Office User', 'Viewer'])
def test_only_system_administrators_read_the_log(fleet, fo1, role):
    c = as_role(role, [fo1])
    assert c.get('/api/audit-logs/').status_code == 403
    assert c.get('/api/audit-logs/facets/').status_code == 403


def test_log_cannot_be_written_through_api_or_changed(fleet, api):
    e = log(type('R', (), {'user': type('U', (), {'is_authenticated': False})(), 'META': {}})(), 'test', 'thing', 'Seeded entry')
    c = as_role('System Administrator')
    assert c.post('/api/audit-logs/', {'action': 'x', 'entity_type': 'y', 'description': 'z'}, format='json').status_code == 405
    assert c.patch(f'/api/audit-logs/{e.pk}/', {'description': 'edited'}, format='json').status_code == 405
    assert c.delete(f'/api/audit-logs/{e.pk}/').status_code == 405
    e.description = 'edited'
    with pytest.raises(PermissionError):
        e.save()
    with pytest.raises(PermissionError):
        e.delete()
    assert AuditLog.objects.get(pk=e.pk).description == 'Seeded entry'
    assert api.get('/api/audit-logs/').status_code == 401
