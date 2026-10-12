"""Phase 7: fuel records, PO log, odometer sequence, estimated km/L."""
import io
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from audit.models import AuditLog
from fleet.models import Vehicle
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle
from operations.models import FuelRecord

pytestmark = pytest.mark.django_db
TODAY = timezone.localdate()
day = lambda n: str(TODAY - timedelta(days=n))


@pytest.fixture(autouse=True)
def setup(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


@pytest.fixture
def vehicle(fo1):
    v = make_vehicle(fo1, 'FUEL 1', current_odometer=10000)
    Vehicle.objects.filter(pk=v.pk).update(fuel_type='DIESEL')
    v.refresh_from_db()
    return v


def add(c, vehicle, odometer, days_ago=0, liters='40', price='60.50', full=False, **kw):
    return c.post('/api/fuel-records/', {
        'vehicle': vehicle.pk, 'date': day(days_ago), 'fuel_type': 'DIESEL', 'liters': liters, 'unit_price': price,
        'odometer': odometer, 'is_full_tank': full, **kw}, format='json')


def test_create_computes_total_and_moves_vehicle_odometer(vehicle, fo1):
    d = make_driver(fo1, 'Pedro', 'L-1')
    c = as_role('Field Office User', [fo1])
    r = add(c, vehicle, 10250, driver=d.pk, po_number=' po-2026-001 ', supplier='  Petron   Tarlac ')
    assert r.status_code == 201, r.json()
    f = r.json()
    assert f['total_amount'] == '2420.00' and f['po_number'] == 'PO-2026-001' and f['supplier'] == 'Petron Tarlac'
    assert f['driver_name'] == 'Pedro' and f['distance_since_last'] is None and f['km_per_liter'] is None
    vehicle.refresh_from_db()
    assert vehicle.current_odometer == 10250
    assert AuditLog.objects.filter(action='odometer_update', entity_id=str(vehicle.pk)).exists()
    assert as_role('System Administrator').delete(f'/api/fuel-records/{f["id"]}/').status_code == 405


def test_total_must_match_receipt_within_a_peso(vehicle):
    c = as_role('Fleet Administrator')
    assert add(c, vehicle, 10100, total_amount='2420.80').status_code == 201  # receipt rounding is fine
    r = add(c, vehicle, 10200, total_amount='2520.00')
    assert r.status_code == 400 and '2,420.00' in r.json()['total_amount'][0]


def test_quantity_price_and_type_checks(vehicle):
    c = as_role('Fleet Administrator')
    assert 'liters' in add(c, vehicle, 10100, liters='0').json()
    assert 'unit_price' in add(c, vehicle, 10100, price='0').json()
    assert 'fuel_type' in add(c, vehicle, 10100, fuel_type='GASOLINE').json()
    assert 'date' in c.post('/api/fuel-records/', {
        'vehicle': vehicle.pk, 'date': str(TODAY + timedelta(days=1)), 'fuel_type': 'DIESEL', 'liters': '10',
        'unit_price': '60', 'odometer': 10100}, format='json').json()


def test_odometer_must_fit_between_neighbouring_fill_ups(vehicle):
    c = as_role('Fleet Administrator')
    add(c, vehicle, 10100, days_ago=10)
    add(c, vehicle, 10500, days_ago=2)
    r = add(c, vehicle, 10050, days_ago=5)
    assert r.status_code == 400 and 'previous fill-up' in r.json()['odometer'][0]
    r = add(c, vehicle, 10600, days_ago=5)
    assert r.status_code == 400 and 'next fill-up' in r.json()['odometer'][0]
    assert add(c, vehicle, 10300, days_ago=5).status_code == 201  # late entry that fits the history
    vehicle.refresh_from_db()
    assert vehicle.current_odometer == 10500  # an older fill-up never moves the odometer


def test_distance_and_km_per_liter_only_between_full_tanks(vehicle):
    c = as_role('Fleet Administrator')
    add(c, vehicle, 10000, days_ago=20, full=True)
    add(c, vehicle, 10200, days_ago=15, liters='15')            # partial: no estimate
    r = add(c, vehicle, 10600, days_ago=10, liters='35', full=True)
    rows = {f['odometer']: f for f in c.get(f'/api/fuel-records/?vehicle={vehicle.pk}').json()['results']}
    assert rows[10200]['distance_since_last'] == 200 and rows[10200]['km_per_liter'] is None
    assert rows[10600]['distance_since_last'] == 400
    # 600 km since the last full tank / (15 + 35) liters added since = 12.00 km/L
    assert rows[10600]['km_per_liter'] == '12.00' == r.json()['km_per_liter']
    assert rows[10000]['km_per_liter'] is None  # first full tank: nothing to compare with
    # date filters don't distort the history-based numbers
    only_last = c.get(f'/api/fuel-records/?vehicle={vehicle.pk}&date_from={day(11)}').json()['results']
    assert only_last[0]['km_per_liter'] == '12.00' and only_last[0]['distance_since_last'] == 400


def test_unusual_consumption_flag(vehicle):
    c = as_role('Fleet Administrator')
    add(c, vehicle, 10000, days_ago=30, full=True)
    add(c, vehicle, 10600, days_ago=25, liters='50', full=True)   # 12 km/L
    add(c, vehicle, 11200, days_ago=20, liters='50', full=True)   # 12 km/L
    add(c, vehicle, 11500, days_ago=15, liters='50', full=True)   # 6 km/L: far below usual
    rows = {f['odometer']: f for f in c.get(f'/api/fuel-records/?vehicle={vehicle.pk}').json()['results']}
    assert rows[11500]['usual_km_per_liter'] == '10.00'  # 1500 km / 150 L
    assert rows[11500]['unusual'] is True and rows[11200]['unusual'] is False


def test_edit_recomputes_total_and_is_audited(vehicle):
    c = as_role('Fleet Administrator')
    f = add(c, vehicle, 10100).json()
    r = c.patch(f'/api/fuel-records/{f["id"]}/', {'liters': '50'}, format='json')
    assert r.status_code == 200 and r.json()['total_amount'] == '3025.00'
    log = AuditLog.objects.filter(action='update', entity_id=str(f['id'])).get()
    assert log.changes['liters'] == ['40.000', '50.000'] and log.changes['total_amount'] == ['2420.00', '3025.00']


def test_po_log_filter_and_summary(vehicle):
    c = as_role('Fleet Administrator')
    add(c, vehicle, 10100, po_number='PO-1', liters='40', price='60')
    add(c, vehicle, 10200, liters='10', price='60', full=True)
    assert [r['po_number'] for r in c.get('/api/fuel-records/?has_po=true').json()['results']] == ['PO-1']
    assert c.get('/api/fuel-records/?search=po-1').json()['count'] == 1
    assert c.get('/api/fuel-records/summary/').json() == {
        'count': 2, 'liters': '50.000', 'amount': '3000.00', 'average_price': '60.00',
        'full_tank_count': 1, 'with_po_count': 1}


def test_scoping_and_permissions(vehicle, fo1):
    fo2 = Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')
    far = make_vehicle(fo2, 'FAR 1')
    theirs = add(as_role('Fleet Administrator'), far, 100, fuel_type=far.fuel_type).json()
    fo = as_role('Field Office User', [fo1])
    assert 'vehicle' in add(fo, far, 200, fuel_type=far.fuel_type).json()
    assert fo.get(f'/api/fuel-records/{theirs["id"]}/').status_code == 404
    assert add(as_role('Viewer'), vehicle, 10100).status_code == 403


def test_receipt_attachment_and_count(vehicle):
    c = as_role('Field Office User', [vehicle.office])
    f = add(c, vehicle, 10100, po_number='PO-9').json()
    r = c.post(f'/api/fuel-records/{f["id"]}/attachments/', {'file': SimpleUploadedFile('receipt.pdf', b'%PDF-1.4 x')})
    assert r.status_code == 201
    assert c.get('/api/fuel-records/?has_po=true').json()['results'][0]['attachment_count'] == 1


def test_db_rejects_negative_amounts_even_without_api(vehicle):
    from django.db import IntegrityError, transaction
    with pytest.raises(IntegrityError), transaction.atomic():
        FuelRecord.objects.create(date=TODAY, vehicle=vehicle, fuel_type='DIESEL', liters=Decimal('-1'),
                                  unit_price=60, total_amount=60, odometer=1)
