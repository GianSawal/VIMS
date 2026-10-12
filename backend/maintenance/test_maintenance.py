"""Phase 8: maintenance records, status flow, vehicle status, schedules (due soon / overdue)."""
import io
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from audit.models import AuditLog
from fleet.models import Vehicle
from fleet.test_vehicles import as_role, make_vehicle
from maintenance.models import MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule
from maintenance.service import schedule_state
from operations.models import Trip

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
    return make_vehicle(fo1, 'MNT 1', current_odometer=20000)


@pytest.fixture
def pms():
    return MaintenanceCategory.objects.get(name='Preventive Maintenance')


@pytest.fixture
def tires():
    return MaintenanceCategory.objects.get(name='Tires')


def create(c, vehicle, cats, **kw):
    return c.post('/api/maintenance/', {'vehicle': vehicle.pk, 'date': day(0), 'description': 'Change oil and filters',
                                        'categories': [x.pk for x in cats], **kw}, format='json')


def move(c, rid, status, **kw):
    return c.post(f'/api/maintenance/{rid}/status/', {'status': status, **kw}, format='json')


def test_create_with_multiple_categories_and_costs(vehicle, pms, tires):
    c = as_role('Field Office User', [vehicle.office])
    r = create(c, vehicle, [pms, tires], reference_number=' pr-2026-014 ', service_provider='  Toyota   Tarlac ',
               labor_cost='1500.50', parts_cost='3200')
    assert r.status_code == 201, r.json()
    m = r.json()
    assert m['status'] == 'SCHEDULED' and m['reference_number'] == 'PR-2026-014' and m['service_provider'] == 'Toyota Tarlac'
    assert sorted(m['category_names']) == ['Preventive Maintenance', 'Tires'] and m['total_cost'] == '4700.50'
    assert AuditLog.objects.filter(action='create', entity_id=str(m['id'])).exists()
    assert as_role('System Administrator').delete(f'/api/maintenance/{m["id"]}/').status_code == 405


def test_validation(vehicle, pms):
    c = as_role('Fleet Administrator')
    assert 'categories' in create(c, vehicle, []).json()
    assert 'labor_cost' in create(c, vehicle, [pms], labor_cost='-5').json()
    assert 'next_service_date' in create(c, vehicle, [pms], next_service_date=day(5)).json()
    assert 'next_service_odometer' in create(c, vehicle, [pms], odometer=20000, next_service_odometer=19000).json()
    disposed = make_vehicle(vehicle.office, 'DSP 1', status='DISPOSED')
    assert 'vehicle' in create(c, disposed, [pms]).json()


def test_status_flow_and_vehicle_status(vehicle, pms):
    c = as_role('Fleet Administrator')
    rid = create(c, vehicle, [pms]).json()['id']
    assert move(c, rid, 'FOR_INSPECTION').status_code == 200
    r = move(c, rid, 'IN_PROGRESS')
    assert r.status_code == 200 and r.json()['started_on'] == day(0)
    vehicle.refresh_from_db()
    assert vehicle.status == 'UNDER_MAINTENANCE'
    assert 'backwards' in str(move(c, rid, 'SCHEDULED').json())
    assert 'already' in str(move(c, rid, 'IN_PROGRESS').json())

    r = move(c, rid, 'COMPLETED', labor_cost='800', parts_cost='1200', odometer=20150)
    assert r.status_code == 200 and r.json()['total_cost'] == '2000.00' and r.json()['completed_on'] == day(0)
    vehicle.refresh_from_db()
    assert vehicle.status == 'SERVICEABLE' and vehicle.current_odometer == 20150
    assert 'already completed' in str(move(c, rid, 'CANCELLED').json())
    log = AuditLog.objects.get(action='maintenance_completed')
    assert 'back to Serviceable' in log.description and log.changes['total_cost'] == [None, '2000.00']


def test_vehicle_stays_in_workshop_until_last_job_ends(vehicle, pms, tires):
    c = as_role('Fleet Administrator')
    a, b = create(c, vehicle, [pms]).json()['id'], create(c, vehicle, [tires]).json()['id']
    move(c, a, 'IN_PROGRESS')
    move(c, b, 'IN_PROGRESS')
    move(c, a, 'COMPLETED')
    vehicle.refresh_from_db()
    assert vehicle.status == 'UNDER_MAINTENANCE'
    move(c, b, 'CANCELLED')
    vehicle.refresh_from_db()
    assert vehicle.status == 'SERVICEABLE'


def test_cannot_start_while_on_trip_or_unserviceable(vehicle, pms, fo1):
    from fleet.test_drivers import make_driver
    c = as_role('Fleet Administrator')
    Trip.objects.create(ticket_number='T1', vehicle=vehicle, driver=make_driver(fo1), departed_at=timezone.now(),
                        odometer_start=20000, origin='a', destination='b', purpose='x', status='DISPATCHED')
    rid = create(c, vehicle, [pms]).json()['id']
    assert 'out on a trip' in str(move(c, rid, 'IN_PROGRESS').json())
    Trip.objects.update(status='COMPLETED', returned_at=timezone.now(), odometer_end=20010)
    Vehicle.objects.filter(pk=vehicle.pk).update(status='UNSERVICEABLE')
    assert 'cannot enter the workshop' in str(move(c, rid, 'IN_PROGRESS').json())


def test_under_maintenance_vehicle_cannot_be_dispatched(vehicle, pms, fo1):
    from fleet.test_drivers import make_driver
    c = as_role('Fleet Administrator')
    move(c, create(c, vehicle, [pms]).json()['id'], 'IN_PROGRESS')
    d = make_driver(fo1)
    r = c.post('/api/trips/', {'vehicle': vehicle.pk, 'driver': d.pk, 'origin': 'a', 'destination': 'b', 'purpose': 'x',
                               'departed_at': timezone.now().isoformat(), 'odometer_start': 20000}, format='json')
    assert r.status_code == 400 and 'vehicle' in r.json()


def test_completion_date_rules(vehicle, pms):
    c = as_role('Fleet Administrator')
    rid = create(c, vehicle, [pms], date=day(10)).json()['id']
    assert 'completed_on' in move(c, rid, 'COMPLETED', completed_on=str(TODAY + timedelta(days=1))).json()
    assert 'completed_on' in move(c, rid, 'COMPLETED', completed_on=day(20)).json()
    assert move(c, rid, 'COMPLETED', completed_on=day(3)).json()['completed_on'] == day(3)


def test_final_records_are_locked_except_remarks(vehicle, pms):
    c = as_role('Fleet Administrator')
    rid = create(c, vehicle, [pms]).json()['id']
    move(c, rid, 'COMPLETED')
    assert c.patch(f'/api/maintenance/{rid}/', {'labor_cost': '1'}, format='json').status_code == 400
    assert c.patch(f'/api/maintenance/{rid}/', {'remarks': 'Warranty claim filed'}, format='json').status_code == 200


def test_completion_resets_schedule_and_suggests_next_service(vehicle, pms):
    MaintenanceSchedule.objects.create(vehicle=vehicle, category=pms, interval_days=180, interval_km=5000,
                                       last_service_date=TODAY - timedelta(days=170), last_service_odometer=15000)
    c = as_role('Fleet Administrator')
    rid = create(c, vehicle, [pms]).json()['id']
    r = move(c, rid, 'COMPLETED', odometer=20100)
    assert r.json()['next_service_date'] == str(TODAY + timedelta(days=180))
    assert r.json()['next_service_odometer'] == 25100
    s = MaintenanceSchedule.objects.get()
    assert s.last_service_date == TODAY and s.last_service_odometer == 20100
    assert schedule_state(s)['status'] == 'OK'
    # typed next-service values win over the suggestion
    rid2 = create(c, vehicle, [pms]).json()['id']
    r = move(c, rid2, 'COMPLETED', odometer=20200, next_service_odometer=24000)
    assert r.json()['next_service_odometer'] == 24000


def test_schedule_due_by_date_and_by_km(vehicle, pms, tires):
    base = dict(vehicle=vehicle)
    by_date = MaintenanceSchedule.objects.create(category=pms, interval_days=180, last_service_date=TODAY - timedelta(days=200), **base)
    soon = MaintenanceSchedule.objects.create(category=tires, interval_days=180, last_service_date=TODAY - timedelta(days=160), **base)
    assert schedule_state(by_date)['status'] == 'OVERDUE' and schedule_state(by_date)['days_left'] == -20
    st = schedule_state(soon)
    assert st['status'] == 'DUE_SOON' and st['days_left'] == 20 and st['due_date'] == TODAY + timedelta(days=20)

    brakes = MaintenanceCategory.objects.get(name='Brakes')
    km = MaintenanceSchedule.objects.create(category=brakes, interval_km=5000, last_service_odometer=15200, **base)
    st = schedule_state(km)  # due at 20,200; vehicle is at 20,000
    assert st['status'] == 'DUE_SOON' and st['km_left'] == 200 and st['due_odometer'] == 20200
    Vehicle.objects.filter(pk=vehicle.pk).update(current_odometer=20300)
    km.vehicle.refresh_from_db()
    assert schedule_state(km)['status'] == 'OVERDUE' and schedule_state(km)['km_left'] == -100


def test_schedule_due_when_either_rule_is_reached(vehicle, pms):
    s = MaintenanceSchedule.objects.create(vehicle=vehicle, category=pms, interval_days=365, interval_km=5000,
                                           last_service_date=TODAY - timedelta(days=10), last_service_odometer=14000)
    assert schedule_state(s)['status'] == 'OVERDUE'  # date is fine, but 6,000 km driven > 5,000


def test_schedule_without_baseline(vehicle, pms):
    s = MaintenanceSchedule.objects.create(vehicle=vehicle, category=pms, interval_days=180)
    assert schedule_state(s)['status'] == 'NO_BASELINE'


def test_schedule_api_filters_summary_and_validation(vehicle, pms, tires):
    c = as_role('Fleet Administrator')
    r = c.post('/api/maintenance-schedules/', {'vehicle': vehicle.pk, 'category': pms.pk, 'interval_days': 180,
                                               'last_service_date': day(200)}, format='json')
    assert r.status_code == 201 and r.json()['due']['status'] == 'OVERDUE'
    c.post('/api/maintenance-schedules/', {'vehicle': vehicle.pk, 'category': tires.pk, 'interval_km': 8000,
                                           'last_service_odometer': 19000}, format='json')
    assert c.post('/api/maintenance-schedules/', {'vehicle': vehicle.pk, 'category': pms.pk, 'interval_days': 90}, format='json').status_code == 400
    assert 'interval_days' in c.post('/api/maintenance-schedules/', {'vehicle': vehicle.pk, 'category': MaintenanceCategory.objects.get(name='Body').pk}, format='json').json()
    assert [s['category_name'] for s in c.get('/api/maintenance-schedules/?due=OVERDUE').json()['results']] == ['Preventive Maintenance']
    assert c.get('/api/maintenance-schedules/summary/').json() == {'total': 2, 'by_due': {'OVERDUE': 1, 'DUE_SOON': 0, 'OK': 1, 'NO_BASELINE': 0}}


def test_scoping_and_permissions(vehicle, pms, fo1):
    fo2 = Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')
    far = make_vehicle(fo2, 'FAR 1')
    theirs = create(as_role('Fleet Administrator'), far, [pms]).json()
    fo = as_role('Field Office User', [fo1])
    assert 'vehicle' in create(fo, far, [pms]).json()
    assert fo.get(f'/api/maintenance/{theirs["id"]}/').status_code == 404
    assert move(fo, theirs['id'], 'IN_PROGRESS').status_code == 404
    mine = create(fo, vehicle, [pms]).json()
    assert move(fo, mine['id'], 'IN_PROGRESS').status_code == 200  # field users run their own office's jobs
    assert create(as_role('Viewer'), vehicle, [pms]).status_code == 403
    assert move(as_role('Viewer'), mine['id'], 'COMPLETED').status_code == 403
    # field users can see but not define PM schedules
    assert fo.post('/api/maintenance-schedules/', {'vehicle': vehicle.pk, 'category': pms.pk, 'interval_days': 90}, format='json').status_code == 403
    assert fo.get('/api/maintenance-schedules/').status_code == 200


def test_filters_summary_insights_and_attachments(vehicle, pms, tires):
    c = as_role('Fleet Administrator')
    done = create(c, vehicle, [pms], labor_cost='1000', parts_cost='500').json()['id']
    move(c, done, 'COMPLETED')
    create(c, vehicle, [tires])
    assert c.get('/api/maintenance/?open=true').json()['count'] == 1
    assert c.get(f'/api/maintenance/?category={tires.pk}').json()['count'] == 1
    assert c.get('/api/maintenance/?search=oil').json()['count'] == 2
    s = c.get('/api/maintenance/summary/').json()
    assert s['by_status']['COMPLETED'] == 1 and s['by_status']['SCHEDULED'] == 1 and s['cost'] == '1500.00'
    ins = c.get('/api/maintenance/insights/').json()
    assert ins['months'][-1]['amount'] == '1500.00'
    assert ins['top_categories'][0]['name'] == 'Preventive Maintenance'

    r = c.post(f'/api/maintenance/{done}/attachments/', {'file': SimpleUploadedFile('pr.pdf', b'%PDF-1.4 x')})
    assert r.status_code == 201
    assert c.get(f'/api/maintenance/{done}/').json()['attachment_count'] == 1


def test_db_rejects_negative_costs(vehicle):
    from django.db import IntegrityError, transaction
    with pytest.raises(IntegrityError), transaction.atomic():
        MaintenanceRecord.objects.create(vehicle=vehicle, date=TODAY, description='x', labor_cost=-1)
