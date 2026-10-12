"""Phase 9: vehicle documents, expiry alert bands (60/30/15/7/expired) and the renewal workflow."""
import io
from datetime import date, timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from audit.models import AuditLog
from fleet import documents
from fleet.models import VehicleDocument
from fleet.test_vehicles import as_role, make_vehicle

pytestmark = pytest.mark.django_db
today = timezone.localdate
PDF = b'%PDF-1.4 test'


@pytest.fixture(autouse=True)
def setup(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    settings.DOCUMENT_ALERT_DAYS = [60, 30, 15, 7]
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


def lto(vehicle, days, **kw):
    return {'vehicle': vehicle.pk, 'document_type': 'LTO_REGISTRATION', 'reference_number': ' lto-1 ',
            'issue_date': str(today() - timedelta(days=300)), 'expiry_date': str(today() + timedelta(days=days)), **kw}


def test_expiry_bands_and_edges():
    t = date(2026, 1, 1)
    band = lambda d: documents.expiry_state(t + timedelta(days=d), today=t)['band']
    assert [band(d) for d in (-1, 0, 7, 8, 15, 16, 30, 31, 60, 61)] == \
        ['EXPIRED', '7', '7', '15', '15', '30', '30', '60', '60', 'VALID']
    assert documents.expiry_state(None) == {'band': 'NONE', 'days_left': None}
    assert documents.bands() == ['EXPIRED', '7', '15', '30', '60', 'VALID', 'NONE']


def test_band_filter_matches_expiry_state(fo1):
    v = make_vehicle(fo1, 'BND 1')
    for i, d in enumerate((-1, 0, 7, 8, 15, 16, 30, 31, 60, 61)):
        VehicleDocument.objects.create(vehicle=v, document_type='OTHER', reference_number=str(i), expiry_date=today() + timedelta(days=d))
    VehicleDocument.objects.create(vehicle=v, document_type='DEED')
    for doc in VehicleDocument.objects.all():
        band = documents.expiry_state(doc.expiry_date)['band']
        assert VehicleDocument.objects.filter(documents.band_filter(band), pk=doc.pk).exists(), (doc.expiry_date, band)
        others = [b for b in documents.bands() if b != band]
        assert not any(VehicleDocument.objects.filter(documents.band_filter(b), pk=doc.pk).exists() for b in others)


def test_create_lists_with_expiry_and_one_current_per_type(fo1):
    v = make_vehicle(fo1, 'DOC 1')
    c = as_role('Fleet Administrator')
    r = c.post('/api/documents/', lto(v, 20), format='json')
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body['reference_number'] == 'LTO-1' and body['status'] == 'ACTIVE' and body['expiry'] == {'band': '30', 'days_left': 20}
    again = c.post('/api/documents/', lto(v, 200), format='json')
    assert again.status_code == 400 and 'Renew it instead' in again.json()['document_type'][0]
    # several "other" documents are fine; LTO needs an expiry date
    assert c.post('/api/documents/', {'vehicle': v.pk, 'document_type': 'OTHER'}, format='json').status_code == 201
    assert c.post('/api/documents/', {'vehicle': v.pk, 'document_type': 'OTHER'}, format='json').status_code == 201
    r = c.post('/api/documents/', {'vehicle': v.pk, 'document_type': 'GSIS_INSURANCE'}, format='json')
    assert r.status_code == 400 and 'expiry_date' in r.json()
    r = c.post('/api/documents/', lto(v, 10, document_type='OR', issue_date=str(today() + timedelta(days=11))), format='json')
    assert r.status_code == 400 and 'expiry_date' in r.json()
    assert AuditLog.objects.filter(action='create', entity_type='fleet.VehicleDocument').count() == 3


def test_renew_keeps_history_and_moves_alerts(fo1):
    v = make_vehicle(fo1, 'REN 1')
    c = as_role('Fleet Administrator')
    old = c.post('/api/documents/', lto(v, 5), format='json').json()
    assert old['expiry']['band'] == '7'
    bad = c.post(f'/api/documents/{old["id"]}/renew/', {'expiry_date': str(today() + timedelta(days=5))}, format='json')
    assert bad.status_code == 400 and 'expire after' in bad.json()['expiry_date'][0]
    r = c.post(f'/api/documents/{old["id"]}/renew/', {'reference_number': 'lto-2', 'issue_date': str(today()),
                                                       'expiry_date': str(today() + timedelta(days=365))}, format='json')
    assert r.status_code == 201, r.json()
    new = r.json()
    assert new['id'] != old['id'] and new['document_type'] == 'LTO_REGISTRATION' and new['vehicle'] == v.pk
    assert new['expiry']['band'] == 'VALID' and new['reference_number'] == 'LTO-2'
    old_now = c.get(f'/api/documents/{old["id"]}/').json()
    assert old_now['status'] == 'SUPERSEDED' and old_now['expiry'] is None  # history doesn't alert
    assert [h['reference_number'] for h in old_now['history']] == ['LTO-2', 'LTO-1']
    # superseded documents can't be renewed again, and only their remarks can change
    assert c.post(f'/api/documents/{old["id"]}/renew/', {'expiry_date': str(today() + timedelta(days=900))}, format='json').status_code == 400
    assert c.patch(f'/api/documents/{old["id"]}/', {'reference_number': 'X'}, format='json').status_code == 400
    assert c.patch(f'/api/documents/{old["id"]}/', {'remarks': 'paid at LTO Tarlac'}, format='json').status_code == 200
    # the expiry cards count only the current one
    s = c.get('/api/documents/summary/', {'vehicle': v.pk}).json()
    assert s['total'] == 1 and s['by_band']['VALID'] == 1 and s['by_band']['7'] == 0
    assert AuditLog.objects.filter(action='document_renew').count() == 1


def test_cancel_wrong_entry_and_vehicle_type_fixed(fo1):
    v, v2 = make_vehicle(fo1, 'CAN 1'), make_vehicle(fo1, 'CAN 2')
    c = as_role('Fleet Administrator')
    d = c.post('/api/documents/', lto(v, 100), format='json').json()
    r = c.patch(f'/api/documents/{d["id"]}/', {'vehicle': v2.pk}, format='json')
    assert r.status_code == 400 and 'cannot change' in str(r.json())
    assert c.post(f'/api/documents/{d["id"]}/cancel/', {}, format='json').status_code == 400  # reason required
    r = c.post(f'/api/documents/{d["id"]}/cancel/', {'reason': 'wrong vehicle'}, format='json')
    assert r.status_code == 200 and r.json()['status'] == 'CANCELLED' and 'wrong vehicle' in r.json()['remarks']
    # a cancelled one doesn't block adding the right one
    assert c.post('/api/documents/', lto(v, 100), format='json').status_code == 201
    assert c.delete(f'/api/documents/{d["id"]}/').status_code in (403, 405)  # no DELETE endpoint


def test_list_filters_by_band_type_and_office_scope(fo1):
    fo2 = Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')
    v1, v2 = make_vehicle(fo1, 'SCP 1'), make_vehicle(fo2, 'SCP 2')
    c = as_role('Fleet Administrator')
    c.post('/api/documents/', lto(v1, -3), format='json')
    c.post('/api/documents/', lto(v2, 45), format='json')
    c.post('/api/documents/', lto(v2, 300, document_type='GSIS_INSURANCE'), format='json')
    assert [d['plate_number'] for d in c.get('/api/documents/', {'band': 'EXPIRED'}).json()['results']] == ['SCP 1']
    assert c.get('/api/documents/', {'band': '60', 'document_type': 'LTO_REGISTRATION'}).json()['count'] == 1
    assert c.get('/api/documents/', {'band': 'bogus'}).json()['count'] == 0
    assert c.get('/api/documents/', {'document_type': 'GSIS_INSURANCE,INSURANCE_POLICY'}).json()['count'] == 1
    # soonest expiry first
    assert [d['expiry']['days_left'] for d in c.get('/api/documents/').json()['results']] == [-3, 45, 300]

    fou = as_role('Field Office User', offices=[fo1])
    r = fou.get('/api/documents/')
    assert r.json()['count'] == 1
    other = VehicleDocument.objects.get(vehicle=v2, document_type='GSIS_INSURANCE')
    assert fou.get(f'/api/documents/{other.pk}/').status_code == 404
    assert fou.post('/api/documents/', lto(v1, 30, document_type='OR'), format='json').status_code == 403  # view only
    assert fou.post(f'/api/documents/{other.pk}/renew/', {}, format='json').status_code == 403
    assert as_role('Viewer').get('/api/documents/summary/').json()['total'] == 3


def test_scanned_file_is_checked_and_replaced(fo1, django_capture_on_commit_callbacks):
    v = make_vehicle(fo1, 'FIL 1')
    c = as_role('Fleet Administrator')
    fake = SimpleUploadedFile('or.pdf', b'not a pdf', content_type='application/pdf')
    r = c.post('/api/documents/', {**lto(v, 90, document_type='OR'), 'file': fake}, format='multipart')
    assert r.status_code == 400 and 'file' in r.json()
    r = c.post('/api/documents/', {**lto(v, 90, document_type='OR'), 'file': SimpleUploadedFile('or.pdf', PDF)}, format='multipart')
    assert r.status_code == 201, r.json()
    doc = VehicleDocument.objects.get(pk=r.json()['id'])
    first = doc.file.name
    assert r.json()['file_name'] != 'or.pdf' and r.json()['file'].endswith(r.json()['file_name'])  # random stored name
    with django_capture_on_commit_callbacks(execute=True):
        r = c.patch(f'/api/documents/{doc.pk}/', {'file': SimpleUploadedFile('or2.pdf', PDF)}, format='multipart')
    assert r.status_code == 200
    doc.refresh_from_db()
    assert doc.file.name != first and not doc.file.storage.exists(first)  # old scan removed after commit
