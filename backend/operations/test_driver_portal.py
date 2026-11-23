"""Driver accounts: start their own trip (with the pre-trip check), tolls and fuel on their trips, notifications
about their trips, the home summary and reporting a vehicle problem."""
import io
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office, User
from fleet.models import Attachment, VehicleAssignment, VehicleDocument
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, image, make_vehicle
from maintenance.models import MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule
from notifications.models import Notification
from operations.models import FuelRecord, RFIDAccount, TollTransaction, Trip
from operations.test_schedule import book, make_scheduled
from operations.test_trips import dispatch

pytestmark = pytest.mark.django_db
NOW = timezone.now()


@pytest.fixture(autouse=True)
def setup(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


@pytest.fixture
def pedro(fo1):
    return make_driver(fo1, 'Pedro Penduko', 'L-1')


@pytest.fixture
def car(fo1):
    return make_vehicle(fo1, 'DRV 1', current_odometer=1000)


def driver_client(driver):
    as_role('System Administrator').post(f'/api/drivers/{driver.pk}/account/')
    driver.refresh_from_db()
    User.objects.filter(pk=driver.user_id).update(must_change_password=False)
    from rest_framework.test import APIClient
    c = APIClient()
    c.force_authenticate(User.objects.get(pk=driver.user_id))
    return c


def notes(driver):
    return list(Notification.objects.filter(recipient=driver.user).order_by('id').values_list('title', flat=True))


def test_driver_starts_own_trip_with_checklist_and_cannot_hand_it_over(fo1, pedro, car):
    c = driver_client(pedro)
    other = make_driver(fo1, 'Juan Cruz', 'L-2')
    trip = make_scheduled(car, pedro, NOW + timedelta(minutes=30))
    r = c.post(f'/api/trips/{trip.pk}/dispatch/', {'odometer_start': 1000, 'driver': other.pk,
                                                   'checklist': {'tires': True, 'brakes': False, 'notes': 'Squeaky'}}, format='json')
    assert r.status_code == 200, r.json()
    trip.refresh_from_db()
    assert trip.status == 'DISPATCHED' and trip.driver == pedro  # the driver field is ignored for drivers
    assert trip.checklist == {'tires': True, 'brakes': False, 'notes': 'Squeaky'}
    assert notes(pedro) == []  # they did it themselves
    bad = make_scheduled(make_vehicle(fo1, 'DRV 2', current_odometer=5), pedro, NOW + timedelta(minutes=40))
    r = c.post(f'/api/trips/{bad.pk}/dispatch/', {'odometer_start': 5, 'checklist': {'wipers': True}}, format='json')
    assert r.status_code == 400 and 'checklist' in r.json()


def test_driver_is_told_about_trips_booked_changed_started_and_cancelled_by_staff(fo1, pedro, car):
    driver_client(pedro)
    juan = make_driver(fo1, 'Juan Cruz', 'L-2')
    driver_client(juan)
    staff = as_role('Fleet Administrator')
    t = book(staff, car, pedro, NOW + timedelta(days=2)).json()
    assert notes(pedro) == [f"New trip {t['ticket_number']}"]
    r = staff.post(f"/api/trips/{t['id']}/reschedule/", {'vehicle': car.pk, 'driver': juan.pk,
                                                         'scheduled_departure': (NOW + timedelta(days=3)).isoformat()}, format='json')
    assert r.status_code == 200, r.json()
    assert notes(pedro)[-1].endswith('reassigned') and notes(juan)[-1].startswith('New trip')
    staff.post(f"/api/trips/{t['id']}/cancel/", {'reason': 'Event moved'}, format='json')
    assert notes(juan)[-1].endswith('cancelled')
    today = make_scheduled(car, pedro, NOW + timedelta(minutes=30))
    assert staff.post(f'/api/trips/{today.pk}/dispatch/', {'odometer_start': 1000}, format='json').status_code == 200
    assert notes(pedro)[-1] == f'Trip {Trip.objects.get(pk=today.pk).ticket_number} started'


def test_driver_records_tolls_and_fuel_on_own_trip(fo1, pedro, car):
    c = driver_client(pedro)
    own = RFIDAccount.objects.create(provider='EASYTRIP', account_number='EASY-12345678', vehicle=car)
    RFIDAccount.objects.create(provider='AUTOSWEEP', account_number='AS-OTHER', vehicle=make_vehicle(fo1, 'DRV 9'))
    trip = dispatch(as_role('Field Office User', [fo1]), car, pedro).json()

    accounts = c.get(f"/api/trips/{trip['id']}/rfid-accounts/").json()
    assert [a['id'] for a in accounts] == [own.pk] and '12345678' not in str(accounts)  # masked for drivers

    r = c.post(f"/api/trips/{trip['id']}/fuel/", {'date': timezone.localdate().isoformat(), 'liters': '20', 'unit_price': '60',
                                                   'odometer': 1050, 'is_full_tank': 'true', 'receipt': image(name='receipt.png')})
    assert r.status_code == 201, r.json()
    fuel = FuelRecord.objects.get()
    assert (fuel.vehicle, fuel.driver, fuel.total_amount) == (car, pedro, 1200) and trip['ticket_number'] in fuel.remarks
    assert Attachment.objects.filter(object_id=fuel.pk, description='Receipt').exists()

    r = c.post(f"/api/trips/{trip['id']}/complete/", {
        'returned_at': (NOW - timedelta(minutes=5)).isoformat(), 'odometer_end': 1100,
        'toll': {'account': own.pk, 'items': [{'kind': 'debit', 'amount': '45', 'description': 'NLEX Balintawak'}]}}, format='json')
    assert r.status_code == 200, r.json()
    assert TollTransaction.objects.get().trip_id == trip['id']


def test_home_shows_license_vehicle_warnings_and_month(fo1, pedro, car):
    c = driver_client(pedro)
    VehicleAssignment.objects.create(vehicle=car, office=fo1, accountable_person='Chief', driver=pedro, start_date=timezone.localdate())
    VehicleDocument.objects.create(vehicle=car, document_type='LTO_REGISTRATION', expiry_date=timezone.localdate() + timedelta(days=5))
    MaintenanceSchedule.objects.create(vehicle=car, category=MaintenanceCategory.objects.get(name='Tires'), interval_km=500,
                                       last_service_odometer=400, last_service_date=timezone.localdate())
    home = c.get('/api/driver/home/').json()
    assert home['driver']['license_status'] == 'VALID' and home['driver']['full_name'] == 'Pedro Penduko'
    [v] = home['vehicles']
    assert v['plate_number'] == 'DRV 1' and v['documents'][0]['type'] == 'LTO Registration'
    assert v['maintenance'][0]['status'] == 'OVERDUE'  # 400 + 500 < 1000 km
    assert home['month'] == {'start': timezone.localdate().replace(day=1).isoformat(), 'trips': 0, 'distance_km': 0}
    assert as_role('Fleet Administrator').get('/api/driver/home/').status_code == 403  # drivers only


def test_report_problem_opens_maintenance_and_tells_the_office(fo1, pedro, car):
    c = driver_client(pedro)
    as_role('Fleet Administrator', [fo1])
    admin = User.objects.get(username='Fleet_Administrator')
    r = c.post('/api/driver/report-problem/', {'vehicle': car.pk, 'description': 'Brakes squeak'}, format='json')
    assert r.status_code == 400 and 'vehicle' in r.json()  # not assigned to Pedro yet
    VehicleAssignment.objects.create(vehicle=car, office=fo1, accountable_person='Chief', driver=pedro, start_date=timezone.localdate())
    r = c.post('/api/driver/report-problem/', {'vehicle': car.pk, 'description': 'Brakes  squeak', 'photo': image(name='brakes.png')})
    assert r.status_code == 201, r.json()
    m = MaintenanceRecord.objects.get()
    assert m.status == 'SCHEDULED' and m.description == 'Reported by driver Pedro Penduko: Brakes squeak'
    assert [x.name for x in m.categories.all()] == ['Other'] and Attachment.objects.filter(object_id=m.pk).exists()
    car.refresh_from_db()
    assert car.status == 'SERVICEABLE'  # reporting does not take the vehicle off the road
    assert Notification.objects.filter(recipient=admin, type='VEHICLE_ISSUE').exists()


def test_drivers_have_no_vehicle_requests(fo1, pedro, car):
    from operations.test_requests import requester, submit
    c = driver_client(pedro)
    _, ana = requester('ana', fo1)
    req = submit(ana, fo1).json()
    assert c.get('/api/vehicle-requests/').status_code == 403
    assert submit(c, fo1).status_code == 403  # drivers drive the trips others request
    assert c.post(f"/api/vehicle-requests/{req['id']}/approve/", {'vehicle': car.pk}, format='json').status_code == 403
    assert c.post(f"/api/vehicle-requests/{req['id']}/decline/", {'reason': 'no'}, format='json').status_code == 403
