"""Phase 12: dashboard figures match the source records, office scope and module permissions."""
import io
from datetime import datetime, time, timedelta
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from fleet.models import Driver, VehicleDocument
from fleet.test_vehicles import as_role, make_vehicle
from maintenance.models import MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule
from operations.models import FuelRecord, Trip

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


def driver(office, name='Juan', days=365):
    return Driver.objects.create(full_name=name, office=office, license_number=f'L-{name}',
                                 license_expiry_date=today() + timedelta(days=days))


def completed_trip(vehicle, drv, km, when=None):
    left = when or timezone.make_aware(datetime.combine(today(), time(0, 30)))  # always this month
    return Trip.objects.create(ticket_number=f'T-{Trip.objects.count() + 1}', vehicle=vehicle, driver=drv, origin='A',
                               destination='B', purpose='P', status='COMPLETED', departed_at=left,
                               returned_at=left + timedelta(hours=1), odometer_start=1000, odometer_end=1000 + km)


@pytest.fixture
def fleet(fo1, fo2):
    """FO1: 2 serviceable + 1 in use + 1 archived; FO2: 1 under maintenance, plus records on both."""
    a = make_vehicle(fo1, 'AAA 1')
    make_vehicle(fo1, 'AAA 2')
    b = make_vehicle(fo1, 'AAA 3', status='IN_USE')
    make_vehicle(fo1, 'OLD 1', is_archived=True)
    c = make_vehicle(fo2, 'BBB 1', status='UNDER_MAINTENANCE', current_odometer=10_000)
    d1, d2 = driver(fo1, 'Juan', days=-1), driver(fo2, 'Pedro', days=20)
    VehicleDocument.objects.create(vehicle=a, document_type='LTO_REGISTRATION', expiry_date=today() - timedelta(days=2))
    VehicleDocument.objects.create(vehicle=b, document_type='LTO_REGISTRATION', expiry_date=today() + timedelta(days=10))
    VehicleDocument.objects.create(vehicle=c, document_type='GSIS_INSURANCE', expiry_date=today() + timedelta(days=40))
    VehicleDocument.objects.create(vehicle=c, document_type='LTO_REGISTRATION', expiry_date=today() + timedelta(days=200))
    cat = MaintenanceCategory.objects.get(name='Engine')
    MaintenanceSchedule.objects.create(vehicle=c, category=cat, interval_km=5000, last_service_odometer=4000)  # overdue
    MaintenanceSchedule.objects.create(vehicle=a, category=cat, interval_days=180,
                                       last_service_date=today() - timedelta(days=170))  # due soon
    for v, amount in ((a, '1500.00'), (c, '2500.00')):
        FuelRecord.objects.create(vehicle=v, date=today(), fuel_type='DIESEL', liters=Decimal('25'), unit_price=Decimal('60'),
                                  total_amount=Decimal(amount), odometer=v.current_odometer + 100)
    r = MaintenanceRecord.objects.create(vehicle=c, date=today(), description='Engine work', labor_cost=1000, parts_cost=500,
                                         status='COMPLETED', completed_on=today())
    r.categories.add(cat)
    MaintenanceRecord.objects.create(vehicle=c, date=today(), description='Open job', status='IN_PROGRESS')
    completed_trip(a, d1, 120)
    completed_trip(a, d1, 30)
    completed_trip(c, d2, 50)
    return locals()


def test_admin_sees_every_office_and_figures_match(fleet):
    r = as_role('System Administrator').get('/api/dashboard/')
    assert r.status_code == 200, r.json()
    d = r.json()
    assert d['vehicles']['total'] == 4  # archived excluded, like the vehicle list
    assert d['vehicles']['by_status']['SERVICEABLE'] == 2 and d['vehicles']['by_status']['IN_USE'] == 1
    assert {o['code']: o['total'] for o in d['vehicles']['by_office']} == {'FO1': 3, 'FO2': 1}
    assert (d['renewals']['lto']['expired'], d['renewals']['lto']['due']) == (1, 1)
    assert d['renewals']['lto']['items'][0]['band'] == 'EXPIRED'
    assert d['renewals']['insurance']['due'] == 1
    assert (d['maintenance_due']['overdue'], d['maintenance_due']['due_soon']) == (1, 1)
    assert d['maintenance_due']['items'][0]['status'] == 'OVERDUE'
    assert (d['licenses']['expired'], d['licenses']['expiring']) == (1, 1)
    assert d['fuel']['amount'] == '4000.00' and d['fuel']['liters'] == '50.000' and d['fuel']['count'] == 2
    assert len(d['fuel']['months']) == 6
    assert d['maintenance_cost']['amount'] == '1500.00' and d['maintenance_cost']['open'] == 1
    u = d['utilization']
    assert (u['trips'], u['distance_km'], u['vehicles_used'], u['operable']) == (3, 200, 2, 4)
    assert u['rate'] == 50 and u['top_vehicles'][0]['plate_number'] == 'AAA 1'
    assert d['activity'] and len(d['activity']) <= 10


def test_dashboard_matches_list_summaries(fleet):
    c = as_role('System Administrator')
    d = c.get('/api/dashboard/').json()
    assert d['vehicles']['by_status'] == {**{k: 0 for k in d['vehicles']['by_status']},
                                          **c.get('/api/vehicles/summary/').json()['by_status']}
    sched = c.get('/api/maintenance-schedules/summary/').json()['by_due']
    assert (d['maintenance_due']['overdue'], d['maintenance_due']['due_soon']) == (sched['OVERDUE'], sched['DUE_SOON'])
    month = today().strftime('%Y-%m')
    first = f'{month}-01'
    fuel = c.get('/api/fuel-records/summary/', {'date_from': first, 'date_to': today().isoformat()}).json()
    assert d['fuel']['amount'] == fuel['amount']
    trips = c.get('/api/trips/summary/', {'date_from': first, 'date_to': today().isoformat()}).json()
    assert d['utilization']['trips'] == trips['by_status']['COMPLETED']


def test_field_user_is_scoped_to_own_office(fleet, fo1, fo2):
    c = as_role('Field Office User', [fo1])
    d = c.get('/api/dashboard/').json()
    assert d['vehicles']['total'] == 3 and [o['code'] for o in d['vehicles']['by_office']] == ['FO1']
    assert d['renewals']['insurance']['due'] == 0  # FO2's insurance
    assert d['maintenance_due']['overdue'] == 0
    assert d['licenses']['expiring'] == 0 and d['licenses']['expired'] == 1
    assert d['fuel']['amount'] == '1500.00'
    assert d['utilization']['trips'] == 2
    assert all(a['plate_number'].startswith(('AAA', 'OLD')) for a in d['activity'])
    # Asking for another office does not widen the scope.
    d = c.get('/api/dashboard/', {'office': fo2.pk}).json()
    assert d['vehicles']['total'] == 0 and d['fuel']['amount'] == '0.00'


def test_office_and_month_filters(fleet, fo2):
    c = as_role('System Administrator')
    d = c.get('/api/dashboard/', {'office': fo2.pk}).json()
    assert d['vehicles']['total'] == 1 and d['fuel']['amount'] == '2500.00' and d['utilization']['trips'] == 1
    last_year = (today().replace(day=1) - timedelta(days=365)).strftime('%Y-%m')
    d = c.get('/api/dashboard/', {'month': last_year}).json()
    assert d['month'] == last_year and d['fuel']['amount'] == '0.00' and d['utilization']['trips'] == 0
    assert c.get('/api/dashboard/', {'month': '2026-13'}).status_code == 400
    assert c.get('/api/dashboard/', {'office': '99999'}).status_code == 400


def test_sections_follow_module_permissions(fleet, fo1):
    from accounts.models import User
    from django.contrib.auth.models import Permission
    u = User.objects.create(username='limited')
    u.offices.set([fo1])
    u.user_permissions.add(Permission.objects.get(codename='view_vehicle'))
    from rest_framework.test import APIClient
    c = APIClient()
    c.force_authenticate(u)
    d = c.get('/api/dashboard/').json()
    assert 'vehicles' in d
    for hidden in ('renewals', 'maintenance_due', 'licenses', 'fuel', 'maintenance_cost', 'utilization'):
        assert hidden not in d
    assert {a['kind'] for a in d['activity']} == {'vehicle'}


def test_logged_out_gets_401(api):
    assert api.get('/api/dashboard/').status_code == 401


def test_query_count_is_bounded(fleet, django_assert_max_num_queries):
    c = as_role('System Administrator')
    with django_assert_max_num_queries(40):
        assert c.get('/api/dashboard/').status_code == 200
