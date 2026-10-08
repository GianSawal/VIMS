"""Phase 4: vehicle API, office scoping, archive, odometer rule, photo upload."""
import io

import pytest
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import Office, User
from audit.models import AuditLog
from fleet.models import Vehicle

pytestmark = pytest.mark.django_db


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


def as_role(role, offices=()):
    u, _ = User.objects.get_or_create(username=role.replace(' ', '_'))
    u.groups.add(Group.objects.get(name=role))
    u.offices.set(offices)
    c = APIClient()
    c.force_authenticate(u)
    return c


def payload(office, **kw):
    return {'plate_number': 'sab 1234', 'make': 'Toyota', 'model': 'Innova', 'vehicle_type': 'VAN',
            'fuel_type': 'DIESEL', 'office': office.pk, 'current_odometer': 1000, **kw}


def image(fmt='PNG', name='car.png', size=(40, 30)):
    buf = io.BytesIO()
    Image.new('RGB', size, 'blue').save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue())


def make_vehicle(office, plate, **kw):
    return Vehicle.objects.create(plate_number=plate, make='Toyota', model='Vios', vehicle_type='SEDAN',
                                  fuel_type='GASOLINE', office=office, **kw)


def test_fleet_admin_crud_and_normalization(fo1):
    c = as_role('Fleet Administrator')
    r = c.post('/api/vehicles/', payload(fo1, engine_number=' eng-1 ', chassis_number=''), format='json')
    assert r.status_code == 201, r.json()
    v = r.json()
    assert v['plate_number'] == 'SAB 1234' and v['engine_number'] == 'ENG-1' and v['chassis_number'] is None
    assert Vehicle.objects.get().created_by.username == 'Fleet_Administrator'

    r = c.patch(f'/api/vehicles/{v["id"]}/', {'status': 'UNDER_MAINTENANCE', 'current_odometer': 1500}, format='json')
    assert r.status_code == 200 and r.json()['status_display'] == 'Under Maintenance'
    log = AuditLog.objects.get(action='update')
    assert log.changes == {'status': ['SERVICEABLE', 'UNDER_MAINTENANCE'], 'current_odometer': ['1000', '1500']}
    assert as_role('System Administrator').delete(f'/api/vehicles/{v["id"]}/').status_code == 405


def test_duplicate_identifiers_rejected_case_insensitively(fo1):
    make_vehicle(fo1, 'SAB 1234', engine_number='ENG-1')
    c = as_role('Fleet Administrator')
    r = c.post('/api/vehicles/', payload(fo1, engine_number='eng-1'), format='json')
    assert r.status_code == 400 and set(r.json()) == {'plate_number', 'engine_number'}


def test_archive_frees_plate_and_blocks_conflicting_reactivation(fo1):
    c = as_role('Fleet Administrator')
    old = make_vehicle(fo1, 'ABC 123')
    assert c.post(f'/api/vehicles/{old.pk}/archive/').status_code == 200
    assert c.get('/api/vehicles/').json()['count'] == 0  # archived hidden by default
    assert c.get('/api/vehicles/?is_archived=true').json()['count'] == 1
    assert c.patch(f'/api/vehicles/{old.pk}/', {'color': 'Red'}, format='json').status_code == 400  # read-only

    assert c.post('/api/vehicles/', payload(fo1, plate_number='abc 123'), format='json').status_code == 201
    r = c.post(f'/api/vehicles/{old.pk}/reactivate/')
    assert r.status_code == 400 and 'plate' in str(r.json())


def test_odometer_cannot_go_down_without_correction_permission(fo1):
    v = make_vehicle(fo1, 'ODO 1', current_odometer=5000)
    r = as_role('Fleet Administrator').patch(f'/api/vehicles/{v.pk}/', {'current_odometer': 4000}, format='json')
    assert r.status_code == 400 and 'current_odometer' in r.json()
    r = as_role('System Administrator').patch(f'/api/vehicles/{v.pk}/', {'current_odometer': 4000}, format='json')
    assert r.status_code == 200
    assert AuditLog.objects.filter(action='odometer_correction', entity_id=str(v.pk)).exists()


def test_disposed_vehicle_cannot_return_to_service(fo1):
    v = make_vehicle(fo1, 'DSP 1', status='DISPOSED')
    r = as_role('Fleet Administrator').patch(f'/api/vehicles/{v.pk}/', {'status': 'SERVICEABLE'}, format='json')
    assert r.status_code == 400


def test_field_office_user_scoped_and_read_only(fo1, fo2):
    mine, theirs = make_vehicle(fo1, 'MINE 1'), make_vehicle(fo2, 'THEIRS 1')
    c = as_role('Field Office User', [fo1])
    assert [v['plate_number'] for v in c.get('/api/vehicles/').json()['results']] == ['MINE 1']
    assert c.get(f'/api/vehicles/{theirs.pk}/').status_code == 404
    assert c.post('/api/vehicles/', payload(fo1), format='json').status_code == 403
    assert c.patch(f'/api/vehicles/{mine.pk}/', {'color': 'x'}, format='json').status_code == 403
    assert c.post(f'/api/vehicles/{mine.pk}/archive/').status_code == 403
    assert c.post(f'/api/vehicles/{mine.pk}/photo/', {'photo': image()}).status_code == 403


def test_scoped_writer_cannot_move_vehicle_to_unauthorized_office(fo1, fo2):
    # A user with change rights but limited offices (e.g. a custom role) still can't write outside them.
    u = User.objects.create_user('scoped')
    u.groups.add(Group.objects.get(name='Field Office User'))
    from django.contrib.auth.models import Permission
    u.user_permissions.add(*Permission.objects.filter(codename__in=['add_vehicle', 'change_vehicle']))
    u.offices.set([fo1])
    c = APIClient()
    c.force_authenticate(u)
    assert c.post('/api/vehicles/', payload(fo2), format='json').status_code == 403
    v = make_vehicle(fo1, 'MOVE 1')
    assert c.patch(f'/api/vehicles/{v.pk}/', {'office': fo2.pk}, format='json').status_code == 403
    assert c.post('/api/vehicles/', payload(fo1), format='json').status_code == 201


def test_viewer_sees_all_but_cannot_write(fo1, fo2):
    make_vehicle(fo1, 'A 1'), make_vehicle(fo2, 'B 1')
    c = as_role('Viewer')
    assert c.get('/api/vehicles/').json()['count'] == 2
    assert c.post('/api/vehicles/', payload(fo1), format='json').status_code == 403


def test_search_and_filters(fo1, fo2):
    make_vehicle(fo1, 'AAA 111'), make_vehicle(fo2, 'BBB 222', status='UNSERVICEABLE')
    c = as_role('Viewer')
    assert c.get('/api/vehicles/?search=bbb').json()['count'] == 1
    assert c.get(f'/api/vehicles/?office={fo1.pk}').json()['count'] == 1
    assert c.get('/api/vehicles/?status=UNSERVICEABLE').json()['results'][0]['plate_number'] == 'BBB 222'


def test_photo_upload_replace_remove(fo1, settings, django_capture_on_commit_callbacks):
    v = make_vehicle(fo1, 'PIC 1')
    c = as_role('Fleet Administrator')

    r = c.post(f'/api/vehicles/{v.pk}/photo/', {'photo': image('JPEG', '../../../etc/car.jpg')})
    assert r.status_code == 200, r.json()
    first = r.json()['photo_url']
    assert first.startswith('/media/fleet/vehicle/') and first.endswith('.jpg')  # safe generated name
    first_path = settings.MEDIA_ROOT / first.removeprefix('/media/')
    assert first_path.exists()

    with django_capture_on_commit_callbacks(execute=True):
        r = c.post(f'/api/vehicles/{v.pk}/photo/', {'photo': image('WEBP', 'x.webp')})
    assert r.status_code == 200 and r.json()['photo_url'].endswith('.webp')
    assert not first_path.exists()  # old file cleaned up

    assert c.delete(f'/api/vehicles/{v.pk}/photo/').status_code == 200
    assert c.get(f'/api/vehicles/{v.pk}/').json()['photo_url'] is None
    assert list(AuditLog.objects.filter(entity_id=str(v.pk)).order_by('id').values_list('action', flat=True)) == [
        'photo_upload', 'photo_replace', 'photo_remove']


def test_photo_validation(fo1, settings):
    v = make_vehicle(fo1, 'PIC 2')
    c = as_role('Fleet Administrator')
    fake = SimpleUploadedFile('car.jpg', b'<?php echo 1; ?>')
    assert c.post(f'/api/vehicles/{v.pk}/photo/', {'photo': fake}).status_code == 400
    assert c.post(f'/api/vehicles/{v.pk}/photo/', {'photo': image('GIF', 'a.gif')}).status_code == 400
    settings.VEHICLE_PHOTO_MAX_BYTES = 100
    r = c.post(f'/api/vehicles/{v.pk}/photo/', {'photo': image(size=(400, 400))})
    assert r.status_code == 400 and 'MB' in str(r.json())


def test_viewer_cannot_change_photo(fo1):
    v = make_vehicle(fo1, 'PIC 3')
    assert as_role('Viewer').post(f'/api/vehicles/{v.pk}/photo/', {'photo': image()}).status_code == 403


def test_summary_counts_respect_filters_and_scope(fo1, fo2):
    make_vehicle(fo1, 'S 1'), make_vehicle(fo1, 'S 2', status='IN_USE'), make_vehicle(fo2, 'S 3', status='IN_USE')
    make_vehicle(fo1, 'S 4', status='IN_USE', is_archived=True)
    admin = as_role('Fleet Administrator')
    assert admin.get('/api/vehicles/summary/').json() == {'total': 3, 'by_status': {'SERVICEABLE': 1, 'IN_USE': 2}}
    assert admin.get(f'/api/vehicles/summary/?office={fo1.pk}').json()['total'] == 2
    assert admin.get('/api/vehicles/summary/?is_archived=true').json()['by_status'] == {'IN_USE': 1}
    scoped = as_role('Field Office User', [fo1])
    assert scoped.get('/api/vehicles/summary/').json()['total'] == 2  # FO2 vehicle never counted
