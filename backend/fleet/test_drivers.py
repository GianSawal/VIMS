"""Phase 5: driver API, license status, attachments, office scoping."""
import io
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from audit.models import AuditLog
from fleet.models import Driver, VehicleAssignment
from fleet.test_vehicles import as_role, image, make_vehicle

pytestmark = pytest.mark.django_db
TODAY = timezone.localdate()


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


def payload(office, **kw):
    return {'full_name': ' Juan   Dela Cruz ', 'office': office.pk, 'license_number': 'n01-23-456789',
            'license_type': 'PROFESSIONAL', 'license_restrictions': 'B, B1',
            'license_issue_date': str(TODAY - timedelta(days=365)),
            'license_expiry_date': str(TODAY + timedelta(days=400)), **kw}


def make_driver(office, name='Pedro Penduko', lic='LIC-1', days=400, **kw):
    return Driver.objects.create(full_name=name, office=office, license_number=lic, license_type='PROFESSIONAL',
                                 license_expiry_date=TODAY + timedelta(days=days), **kw)


def pdf(name='license.pdf', body=b'%PDF-1.4 test'):
    return SimpleUploadedFile(name, body)


def test_fleet_admin_crud_normalizes_and_audits(fo1):
    c = as_role('Fleet Administrator')
    r = c.post('/api/drivers/', payload(fo1, employee_number=' e-100 '), format='json')
    assert r.status_code == 201, r.json()
    d = r.json()
    assert d['full_name'] == 'Juan Dela Cruz' and d['license_number'] == 'N01-23-456789'
    assert d['employee_number'] == 'E-100' and d['license_status'] == 'VALID'
    assert Driver.objects.get().created_by.username == 'Fleet_Administrator'

    r = c.patch(f'/api/drivers/{d["id"]}/', {'contact_number': '0917 000 0000'}, format='json')
    assert r.status_code == 200
    assert AuditLog.objects.get(action='update').changes == {'contact_number': ['', '0917 000 0000']}
    assert as_role('System Administrator').delete(f'/api/drivers/{d["id"]}/').status_code == 405


def test_duplicate_license_and_employee_number_rejected(fo1):
    make_driver(fo1, lic='N01-23-456789', employee_number='E-100')
    r = as_role('Fleet Administrator').post('/api/drivers/', payload(fo1, employee_number='e-100'), format='json')
    assert r.status_code == 400 and set(r.json()) == {'license_number', 'employee_number'}


def test_blank_employee_numbers_do_not_collide(fo1):
    c = as_role('Fleet Administrator')
    assert c.post('/api/drivers/', payload(fo1, license_number='A-1', employee_number=''), format='json').status_code == 201
    assert c.post('/api/drivers/', payload(fo1, license_number='A-2', employee_number=''), format='json').status_code == 201


def test_license_dates_validated(fo1):
    r = as_role('Fleet Administrator').post(
        '/api/drivers/', payload(fo1, license_issue_date=str(TODAY), license_expiry_date=str(TODAY - timedelta(days=1))),
        format='json')
    assert r.status_code == 400 and 'license_expiry_date' in r.json()


def test_license_status_and_filter(fo1):
    make_driver(fo1, 'Valid', 'L-1', days=200)
    make_driver(fo1, 'Soon', 'L-2', days=30)
    make_driver(fo1, 'Today', 'L-3', days=0)
    make_driver(fo1, 'Expired', 'L-4', days=-1)
    c = as_role('Viewer')
    got = {d['full_name']: d['license_status'] for d in c.get('/api/drivers/').json()['results']}
    assert got == {'Valid': 'VALID', 'Soon': 'EXPIRING', 'Today': 'EXPIRING', 'Expired': 'EXPIRED'}
    names = lambda q: sorted(d['full_name'] for d in c.get(f'/api/drivers/?license_status={q}').json()['results'])
    assert names('EXPIRED') == ['Expired'] and names('EXPIRING') == ['Soon', 'Today'] and names('VALID') == ['Valid']
    assert c.get('/api/drivers/?search=soon').json()['count'] == 1


def test_field_office_user_scoped_and_read_only(fo1, fo2):
    mine, theirs = make_driver(fo1, 'Mine', 'L-1'), make_driver(fo2, 'Theirs', 'L-2')
    c = as_role('Field Office User', [fo1])
    assert [d['full_name'] for d in c.get('/api/drivers/').json()['results']] == ['Mine']
    assert c.get(f'/api/drivers/{theirs.pk}/').status_code == 404
    assert c.get(f'/api/drivers/{theirs.pk}/attachments/').status_code == 404
    assert c.post('/api/drivers/', payload(fo1), format='json').status_code == 403
    assert c.patch(f'/api/drivers/{mine.pk}/', {'full_name': 'x'}, format='json').status_code == 403


def test_driver_on_assignment_cannot_be_deactivated(fo1):
    d, v = make_driver(fo1), make_vehicle(fo1, 'A 1')
    VehicleAssignment.objects.create(vehicle=v, office=fo1, accountable_person='X', driver=d, start_date=TODAY)
    c = as_role('Fleet Administrator')
    r = c.patch(f'/api/drivers/{d.pk}/', {'is_active': False}, format='json')
    assert r.status_code == 400 and 'is_active' in r.json()
    VehicleAssignment.objects.update(end_date=TODAY)
    assert c.patch(f'/api/drivers/{d.pk}/', {'is_active': False}, format='json').status_code == 200


def test_driver_shows_current_vehicles_and_history(fo1):
    d, v = make_driver(fo1), make_vehicle(fo1, 'CUR 1')
    VehicleAssignment.objects.create(vehicle=v, office=fo1, accountable_person='X', driver=d,
                                     driver_name=d.full_name, start_date=TODAY)
    c = as_role('Viewer')
    assert c.get(f'/api/drivers/{d.pk}/').json()['current_vehicles'][0]['plate_number'] == 'CUR 1'
    hist = c.get(f'/api/drivers/{d.pk}/assignments/').json()
    assert hist['count'] == 1 and hist['results'][0]['plate_number'] == 'CUR 1'


def test_attachment_upload_list_delete(fo1, settings, django_capture_on_commit_callbacks):
    d = make_driver(fo1)
    c = as_role('Fleet Administrator')
    r = c.post(f'/api/drivers/{d.pk}/attachments/', {'file': pdf('../../license scan.pdf'), 'description': 'Front'})
    assert r.status_code == 201, r.json()
    att = r.json()
    assert att['original_name'] == 'license scan.pdf' and att['url'].startswith('/media/fleet/attachment/')
    assert att['url'].endswith('.pdf')
    path = settings.MEDIA_ROOT / att['url'].removeprefix('/media/')
    assert path.exists()
    assert c.post(f'/api/drivers/{d.pk}/attachments/', {'file': image('JPEG', 'back.jpg')}).status_code == 201
    assert len(c.get(f'/api/drivers/{d.pk}/attachments/').json()) == 2

    with django_capture_on_commit_callbacks(execute=True):
        assert c.delete(f'/api/drivers/{d.pk}/attachments/{att["id"]}/').status_code == 204
    assert not path.exists()
    assert len(c.get(f'/api/drivers/{d.pk}/attachments/').json()) == 1
    assert list(AuditLog.objects.filter(entity_id=str(d.pk)).order_by('id').values_list('action', flat=True)) == [
        'attachment_add', 'attachment_add', 'attachment_remove']


def test_attachment_validation(fo1, settings):
    d = make_driver(fo1)
    c = as_role('Fleet Administrator')
    url = f'/api/drivers/{d.pk}/attachments/'
    assert c.post(url, {'file': SimpleUploadedFile('x.exe', b'MZ')}).status_code == 400
    assert c.post(url, {'file': SimpleUploadedFile('fake.pdf', b'<?php ?>')}).status_code == 400
    assert c.post(url, {'file': SimpleUploadedFile('fake.png', b'not an image')}).status_code == 400
    settings.ATTACHMENT_MAX_BYTES = 10
    r = c.post(url, {'file': pdf(body=b'%PDF-1.4 ' + b'x' * 100)})
    assert r.status_code == 400 and 'MB' in str(r.json())


def test_attachment_permissions(fo1, fo2):
    d, other = make_driver(fo1, 'D1', 'L-1'), make_driver(fo2, 'D2', 'L-2')
    att = as_role('Fleet Administrator').post(f'/api/drivers/{d.pk}/attachments/', {'file': pdf()}).json()
    for role in ('Viewer', 'Field Office User'):
        c = as_role(role, [fo1])
        assert c.get(f'/api/drivers/{d.pk}/attachments/').status_code == 200
        assert c.post(f'/api/drivers/{d.pk}/attachments/', {'file': pdf()}).status_code == 403
        assert c.delete(f'/api/drivers/{d.pk}/attachments/{att["id"]}/').status_code == 403
    # an attachment id from another driver can't be deleted through this driver's URL
    other_att = as_role('Fleet Administrator').post(f'/api/drivers/{other.pk}/attachments/', {'file': pdf()}).json()
    assert as_role('Fleet Administrator').delete(f'/api/drivers/{d.pk}/attachments/{other_att["id"]}/').status_code == 404


def test_summary_counts_respect_filters_and_scope(fo1, fo2):
    make_driver(fo1, 'A', 'L-1', days=200), make_driver(fo1, 'B', 'L-2', days=10)
    make_driver(fo1, 'C', 'L-3', days=-3), make_driver(fo2, 'D', 'L-4', days=-3)
    make_driver(fo1, 'E', 'L-5', days=200, is_active=False)
    admin = as_role('Viewer')
    assert admin.get('/api/drivers/summary/').json() == {
        'total': 5, 'by_license': {'VALID': 2, 'EXPIRING': 1, 'EXPIRED': 2}}
    assert admin.get(f'/api/drivers/summary/?office={fo1.pk}&is_active=true').json()['total'] == 3
    scoped = as_role('Field Office User', [fo1])
    assert scoped.get('/api/drivers/summary/').json()['by_license']['EXPIRED'] == 1  # FO2's expired driver hidden
