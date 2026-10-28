"""Phase 16: endpoint-wide authorization review, office-scoping penetration tests, protected media, rate limits,
security headers and log redaction. The endpoint lists come from the OpenAPI schema, so a new endpoint is covered
(or fails here) without editing this file."""
import io
import logging
import re
import sys
from datetime import date

import pytest
from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APIClient

from accounts.models import Office, User
from accounts.throttles import ExportThrottle
from config.log_filters import RedactSecrets, redact
from config.urls import router
from fleet.models import Attachment, VehicleDocument
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, image, make_vehicle
from maintenance.models import MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule
from operations.models import DisplayScreen, FuelRecord, RFIDAccount, TollTransaction, Trip

pytestmark = pytest.mark.django_db
METHODS = ['get', 'post', 'put', 'patch', 'delete']
PARAMS = {'slug': 'vehicle-master-list', 'op': 'status'}

# Open without login, on purpose.
PUBLIC = {('/api/auth/csrf/', 'get'), ('/api/auth/login/', 'post'), ('/api/display/trips/', 'get')}
# Logged-in users with no role may still use these: their own session, password and notifications, and the lists
# that answer "what may I see" (empty for them).
OWN = {('/api/auth/me/', 'get'), ('/api/auth/logout/', 'post'), ('/api/auth/change-password/', 'post'),
       ('/api/notifications/', 'get'), ('/api/notifications/unread-count/', 'get'),
       ('/api/notifications/{id}/read/', 'post'), ('/api/notifications/read-all/', 'post'),
       ('/api/reports/', 'get'), ('/api/dashboard/', 'get')}
# The only DELETEs: removing a photo or an attachment file (the record itself is kept). Records are archived instead.
DELETES = {'/api/vehicles/{id}/photo/', '/api/drivers/{id}/photo/', '/api/drivers/{id}/attachments/{att_id}/',
           '/api/trips/{id}/attachments/{att_id}/', '/api/fuel-records/{id}/attachments/{att_id}/',
           '/api/maintenance/{id}/attachments/{att_id}/'}


@pytest.fixture(autouse=True)
def setup(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture(scope='module')
def endpoints():
    schema = SchemaGenerator().get_schema(request=None, public=True)
    return [(path, m) for path, ops in schema['paths'].items() for m in METHODS if m in ops]


def concrete(path, pk=1):
    return re.sub(r'\{(\w+)\}', lambda m: PARAMS.get(m.group(1), str(pk)), path)


def call(client, method, url):
    return getattr(client, method)(url, {}, format='json') if method != 'get' else client.get(url)


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


@pytest.fixture
def fo2():
    return Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')


# --- authorization review: every endpoint ---------------------------------------------------------------------------

def test_every_endpoint_needs_login(endpoints):
    anon = APIClient()
    open_ones = []
    for path, method in endpoints:
        code = call(anon, method, concrete(path)).status_code
        if (path, method) in PUBLIC:
            continue
        if code != 401:
            open_ones.append((method.upper(), path, code))
    assert not open_ones, f'answer without login: {open_ones}'


def test_every_endpoint_refuses_a_user_without_a_role(endpoints):
    u = User.objects.create(username='norole')
    c = APIClient()
    c.force_authenticate(u)
    allowed = []
    for path, method in endpoints:
        if (path, method) in PUBLIC | OWN:
            continue
        code = call(c, method, concrete(path)).status_code
        if code not in (403, 404, 405):  # 404/405: refused before or instead of the permission check
            allowed.append((method.upper(), path, code))
    assert not allowed, f'reachable without any permission: {allowed}'


def test_pending_password_change_blocks_everything_but_the_change(endpoints):
    admin = User.objects.create(username='fresh', must_change_password=True, is_superuser=True)
    c = APIClient()
    c.force_authenticate(admin)
    for path, method in endpoints:
        if method != 'get' or (path, method) in PUBLIC | OWN or '{' in path:
            continue
        assert c.get(path).status_code == 403, path


def test_no_delete_endpoints_except_files(endpoints):
    assert {p for p, m in endpoints if m == 'delete'} == DELETES


def test_api_docs_need_login():
    assert APIClient().get('/api/schema/').status_code == 401
    assert APIClient().get('/api/docs/').status_code == 401
    assert as_role('Viewer').get('/api/schema/').status_code == 200


def test_viewer_cannot_write_anywhere(endpoints):
    c = as_role('Viewer')
    wrote = [(m.upper(), p, code) for p, m in endpoints if m != 'get' and (p, m) not in PUBLIC | OWN
             and (code := call(c, m, concrete(p)).status_code) not in (403, 404, 405)]
    assert not wrote, f'Viewer reached a write endpoint: {wrote}'


# --- office scoping: a Field Office User of FO1 against FO2's records -------------------------------------------------

@pytest.fixture
def far(fo2):
    """One record of every office-scoped kind, in FO2."""
    v = make_vehicle(fo2, 'FAR 1', current_odometer=5000)
    d = make_driver(fo2, 'Far Driver', 'L-FAR')
    trip = Trip.objects.create(ticket_number='T-FAR', vehicle=v, driver=d, origin='A', destination='B', purpose='x',
                               departed_at=timezone.now(), odometer_start=5000)
    acc = RFIDAccount.objects.create(provider='EASYTRIP', account_number='EASY-999', vehicle=v)
    return {
        'offices': fo2, 'vehicles': v, 'drivers': d, 'trips': trip, 'rfid-accounts': acc,
        'documents': VehicleDocument.objects.create(vehicle=v, document_type='OTHER',
                                                    file=SimpleUploadedFile('far.pdf', b'%PDF-1.4 far')),
        'fuel-records': FuelRecord.objects.create(date=date.today(), vehicle=v, fuel_type='GASOLINE', liters=10,
                                                  unit_price=60, total_amount=600, odometer=5000),
        'toll-transactions': TollTransaction.objects.create(account=acc, vehicle=v, transacted_at=timezone.now(),
                                                            description='NLEX', debit=50),
        'maintenance': MaintenanceRecord.objects.create(vehicle=v, date=date.today(), description='Oil'),
        'maintenance-schedules': MaintenanceSchedule.objects.create(
            vehicle=v, category=MaintenanceCategory.objects.get(name='Tires'), interval_days=180),
        'display-screens': DisplayScreen.objects.create(name='Far TV', office=fo2),
    }


def test_every_office_scoped_viewset_is_covered(far):
    scoped = {prefix for prefix, vs, _ in router.registry if getattr(vs, 'office_field', None)}
    assert scoped == set(far), f'add a record for: {scoped ^ set(far)}'


def test_field_office_user_never_sees_or_touches_another_office(endpoints, fo1, far):
    c = as_role('Field Office User', [fo1])
    for prefix, obj in far.items():
        listed = c.get(f'/api/{prefix}/', {'page_size': 500})
        if listed.status_code == 200:
            body = listed.json()
            rows = body['results'] if isinstance(body, dict) else body
            assert obj.pk not in [r['id'] for r in rows], prefix
        for path, method in endpoints:
            if path.startswith(f'/api/{prefix}/{{id}}/'):
                code = call(c, method, concrete(path, obj.pk)).status_code
                assert code in (403, 404, 405), (method, path, code)


def test_field_office_user_cannot_create_records_on_another_offices_vehicle(fo1, far):
    c = as_role('Field Office User', [fo1])
    v, d = far['vehicles'], far['drivers']
    attempts = {
        '/api/trips/': {'vehicle': v.pk, 'driver': d.pk, 'origin': 'A', 'destination': 'B', 'purpose': 'x',
                        'departed_at': timezone.now().isoformat(), 'odometer_start': 5000},
        '/api/fuel-records/': {'vehicle': v.pk, 'date': str(date.today()), 'fuel_type': 'GASOLINE', 'liters': '5',
                               'unit_price': '60', 'odometer': 5100},
        '/api/maintenance/': {'vehicle': v.pk, 'date': str(date.today()), 'description': 'x', 'categories': []},
        '/api/toll-transactions/': {'account': far['rfid-accounts'].pk, 'vehicle': v.pk, 'description': 'x',
                                    'transacted_at': timezone.now().isoformat(), 'debit': '10'},
    }
    for url, payload in attempts.items():
        r = c.post(url, payload, format='json')
        assert r.status_code in (400, 403, 404), (url, r.status_code, r.content[:200])
    assert not Trip.objects.exclude(pk=far['trips'].pk).exists()
    assert FuelRecord.objects.count() == MaintenanceRecord.objects.count() == TollTransaction.objects.count() == 1


def test_reports_and_export_stay_in_office(fo1, far):
    c = as_role('Field Office User', [fo1])
    r = c.get('/api/reports/vehicle-master-list/')
    assert r.status_code == 200 and far['vehicles'].plate_number not in str(r.content)
    assert c.get('/api/reports/vehicle-history/', {'vehicle': far['vehicles'].pk}).status_code == 404


# --- protected media ---------------------------------------------------------------------------------------------------

def browser(role=None, offices=()):
    """A session login (the media view is plain Django, so DRF's force_authenticate doesn't reach it)."""
    if role:
        as_role(role, offices)
    user = User.objects.get_or_create(username=role.replace(' ', '_') if role else 'norole')[0]
    c = APIClient()
    c.force_login(user)
    return c


def test_photos_are_public_but_documents_and_attachments_are_not(fo1, far):
    v = far['vehicles']
    v.photo = SimpleUploadedFile('p.png', image().read())
    v.save()
    assert APIClient().get(v.photo.url).status_code == 200

    doc_url = far['documents'].file.url
    assert APIClient().get(doc_url).status_code == 401
    assert browser('Field Office User', [fo1]).get(doc_url).status_code == 404  # other office: not even 403
    assert browser().get(doc_url).status_code == 403
    r = browser('Viewer').get(doc_url)
    assert r.status_code == 200 and b''.join(r.streaming_content) == b'%PDF-1.4 far'
    assert r['Cache-Control'] == 'private, no-store' and r['X-Content-Type-Options'] == 'nosniff'

    att = Attachment.objects.create(content_type=ContentType.objects.get_for_model(Trip), object_id=far['trips'].pk,
                                    file=SimpleUploadedFile('ticket.pdf', b'%PDF-1.4 t'), original_name='Trip ticket.pdf',
                                    size=10)
    assert APIClient().get(att.file.url).status_code == 401
    assert browser('Field Office User', [fo1]).get(att.file.url).status_code == 404
    r = browser('Field Office User', [far['offices']]).get(att.file.url)
    assert r.status_code == 200 and "Trip%20ticket.pdf" in r['Content-Disposition']


def test_media_never_serves_unknown_files_or_escapes_media_root(settings, far):
    (settings.MEDIA_ROOT / 'stray.pdf').write_bytes(b'%PDF-1.4 stray')
    admin = browser('System Administrator')
    assert admin.get('/media/stray.pdf').status_code == 404  # on disk, but no record points at it
    assert admin.get('/media/../settings.py').status_code == 404
    assert admin.get('/media/fleet/../../x').status_code == 404


def test_media_hands_off_to_nginx_when_configured(settings, far):
    settings.MEDIA_ACCEL_REDIRECT = '/protected-media/'
    r = browser('Viewer').get(far['documents'].file.url)
    assert r.status_code == 200 and r['X-Accel-Redirect'] == '/protected-media/' + far['documents'].file.name
    assert r['Content-Type'] == 'application/pdf'


# --- uploads -------------------------------------------------------------------------------------------------------------

def test_attachment_content_must_match_its_extension(fo1):
    d = make_driver(fo1, 'Pedro', 'L-1')
    c = as_role('Fleet Administrator')
    url = f'/api/drivers/{d.pk}/attachments/'
    assert c.post(url, {'file': SimpleUploadedFile('scan.png', image('JPEG', 'x.jpg').read())}).status_code == 400
    assert c.post(url, {'file': SimpleUploadedFile('scan.jpg', image('JPEG', 'x.jpg').read())}).status_code == 201
    assert c.post(url, {'file': SimpleUploadedFile('page.html', b'<script>alert(1)</script>')}).status_code == 400
    assert c.post(url, {'file': SimpleUploadedFile('fake.pdf', b'<html>')}).status_code == 400


# --- rate limits -----------------------------------------------------------------------------------------------------------

def test_failed_logins_are_limited_per_username_across_ips(api):
    User.objects.create_user('target', password='Correct-horse-9')
    api.get('/api/auth/csrf/')
    headers = {'HTTP_X_CSRFTOKEN': api.cookies['csrftoken'].value}
    for i in range(20):
        r = api.post('/api/auth/login/', {'username': 'Target', 'password': f'wrong-{i}'}, format='json',
                     REMOTE_ADDR=f'10.0.0.{i}', **headers)
        assert r.status_code == 400
    r = api.post('/api/auth/login/', {'username': 'target', 'password': 'Correct-horse-9'}, format='json',
                 REMOTE_ADDR='10.0.1.1', **headers)
    assert r.status_code == 429  # even the right password waits; the limit is on the account, not the address
    other = api.post('/api/auth/login/', {'username': 'someone-else', 'password': 'x'}, format='json',
                     REMOTE_ADDR='10.0.1.2', **headers)
    assert other.status_code == 400


def test_successful_login_resets_the_username_count(api):
    User.objects.create_user('target', password='Correct-horse-9')
    api.get('/api/auth/csrf/')
    headers = {'HTTP_X_CSRFTOKEN': api.cookies['csrftoken'].value}
    for i in range(5):
        api.post('/api/auth/login/', {'username': 'target', 'password': 'nope'}, format='json',
                 REMOTE_ADDR=f'10.0.2.{i}', **headers)
    ok = api.post('/api/auth/login/', {'username': 'target', 'password': 'Correct-horse-9'}, format='json',
                  REMOTE_ADDR='10.0.2.9', **headers)
    assert ok.status_code == 200
    from django.core.cache import cache
    assert not [k for k in cache._cache if 'login_user' in str(k)]


def test_exports_are_rate_limited_but_previews_are_not(monkeypatch):
    monkeypatch.setattr(ExportThrottle, 'THROTTLE_RATES', {'export': '2/min'})
    c = as_role('System Administrator')
    for _ in range(5):
        assert c.get('/api/reports/vehicle-master-list/').status_code == 200
    codes = [c.get('/api/reports/vehicle-master-list/', {'export': 'csv'}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert c.get('/api/export/vehicle-record/').status_code == 429


# --- headers, logging ------------------------------------------------------------------------------------------------------

def test_security_headers():
    r = APIClient().get('/api/auth/csrf/')
    assert r['X-Frame-Options'] == 'DENY'
    assert r['X-Content-Type-Options'] == 'nosniff'
    assert r['Referrer-Policy'] == 'same-origin'
    assert r['Cross-Origin-Opener-Policy'] == 'same-origin'
    assert r.cookies['csrftoken']['samesite'] == 'Lax'


def test_session_cookie_is_httponly(api):
    User.objects.create_user('u1', password='Correct-horse-9')
    api.get('/api/auth/csrf/')
    r = api.post('/api/auth/login/', {'username': 'u1', 'password': 'Correct-horse-9'}, format='json',
                 HTTP_X_CSRFTOKEN=api.cookies['csrftoken'].value)
    assert r.cookies['sessionid']['httponly'] and r.cookies['sessionid']['samesite'] == 'Lax'


@pytest.mark.parametrize('line', [
    'GET https://us1.locationiq.com/v1/autocomplete?key=pk.abc123&q=Tarlac',
    "{'username': 'juan', 'password': 'Secret-123'}",
    'Cookie: sessionid=abc123; csrftoken=def456',
    'Authorization: Bearer eyJhbGciOi',
    '/api/display/trips/?token=0123456789abcdef',
])
def test_log_lines_are_redacted(line):
    out = redact(line)
    for secret in ('pk.abc123', 'Secret-123', 'abc123', 'def456', 'eyJhbGciOi', '0123456789abcdef'):
        assert secret not in out
    assert '***' in out


def test_redaction_also_covers_tracebacks():
    try:
        raise ValueError('failed GET /route?key=topsecret')
    except ValueError:
        record = logging.LogRecord('x', logging.ERROR, __file__, 1, 'map call failed %s', ('password=hunter2',), None)
        record.exc_info = sys.exc_info()
    RedactSecrets().filter(record)
    assert 'hunter2' not in record.getMessage() and 'topsecret' not in record.exc_text


def test_failed_login_audit_never_stores_the_password(api):
    from audit.models import AuditLog
    api.get('/api/auth/csrf/')
    api.post('/api/auth/login/', {'username': 'ghost', 'password': 'Tried-This-1'}, format='json',
             HTTP_X_CSRFTOKEN=api.cookies['csrftoken'].value)
    entry = AuditLog.objects.get(action='login_failed')
    assert 'Tried-This-1' not in f'{entry.description} {entry.changes}'


def test_display_board_refuses_missing_or_unknown_tokens():
    assert APIClient().get('/api/display/trips/').status_code in (403, 404)
    assert APIClient().get('/api/display/trips/', {'token': 'x' * 40}).status_code in (403, 404)
