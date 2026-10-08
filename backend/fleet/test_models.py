"""Phase 2: schema-level business rules (constraints + model validation)."""
import datetime as dt
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction

from accounts.models import Office
from fleet.models import Driver, Vehicle, VehicleAssignment, VehicleDocument
from maintenance.models import MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule
from notifications.models import Notification
from operations.models import FuelRecord, Trip

pytestmark = pytest.mark.django_db
D = dt.date


@pytest.fixture
def office():
    return Office.objects.create(code='RO', name='Regional Office', office_type='REGIONAL')


@pytest.fixture
def vehicle(office):
    return Vehicle.objects.create(plate_number='SAB1234', make='Toyota', model='Innova', vehicle_type='VAN',
                                  fuel_type='DIESEL', office=office)


@pytest.fixture
def driver(office):
    return Driver.objects.create(full_name='Juan Dela Cruz', office=office, license_number='N01-23-456789',
                                 license_type='PROFESSIONAL', license_expiry_date=D(2030, 1, 1))


def violates(fn):
    with pytest.raises(IntegrityError), transaction.atomic():
        fn()


def test_plate_unique_among_active_only(vehicle, office):
    dup = Vehicle(plate_number='sab1234 ', make='X', model='Y', vehicle_type='SUV', fuel_type='DIESEL', office=office)
    with pytest.raises(ValidationError, match='plate number'):
        dup.full_clean()
    vehicle.is_archived = True
    vehicle.save()
    dup.full_clean()  # archived plate may be reused
    assert dup.plate_number == 'SAB1234'


def test_blank_identifiers_stored_as_null_so_unique_allows_many(vehicle, office):
    v = Vehicle(plate_number='ABC999', make='X', model='Y', vehicle_type='SUV', fuel_type='DIESEL',
                office=office, engine_number='  ')
    v.full_clean()
    v.save()
    assert v.engine_number is None and vehicle.engine_number is None


def test_one_open_assignment_per_vehicle(vehicle, office, driver):
    VehicleAssignment.objects.create(vehicle=vehicle, office=office, accountable_person='A', start_date=D(2025, 1, 1))
    second = VehicleAssignment(vehicle=vehicle, office=office, accountable_person='B', start_date=D(2025, 6, 1))
    with pytest.raises(ValidationError, match='current assignment'):
        second.full_clean()
    assert vehicle.current_assignment.accountable_person == 'A'


def test_date_order_constraints(vehicle, office):
    violates(lambda: VehicleAssignment.objects.create(vehicle=vehicle, office=office, accountable_person='A',
                                                      start_date=D(2025, 2, 1), end_date=D(2025, 1, 1)))
    violates(lambda: VehicleDocument.objects.create(vehicle=vehicle, document_type='OR',
                                                    issue_date=D(2025, 2, 1), expiry_date=D(2025, 1, 1)))


def test_trip_distance_and_odometer_rule(vehicle, driver):
    t = Trip.objects.create(ticket_number='T-1', vehicle=vehicle, driver=driver, origin='RO', destination='FO',
                            purpose='x', departed_at='2025-01-01T08:00+08:00', odometer_start=1000, odometer_end=1150)
    t.refresh_from_db()
    assert t.distance_km == 150
    violates(lambda: Trip.objects.create(ticket_number='T-2', vehicle=vehicle, driver=driver, origin='a',
                                         destination='b', purpose='x', departed_at='2025-01-02T08:00+08:00',
                                         odometer_start=1000, odometer_end=900))


def test_negative_amounts_rejected(vehicle):
    violates(lambda: FuelRecord.objects.create(date=D(2025, 1, 1), vehicle=vehicle, fuel_type='DIESEL',
                                               liters=Decimal('-1'), unit_price=60, total_amount=60, odometer=1))
    violates(lambda: MaintenanceRecord.objects.create(vehicle=vehicle, date=D(2025, 1, 1), description='x',
                                                      labor_cost=-5))


def test_maintenance_total_is_generated(vehicle):
    m = MaintenanceRecord.objects.create(vehicle=vehicle, date=D(2025, 1, 1), description='PMS',
                                         labor_cost=Decimal('500.50'), parts_cost=Decimal('1200'))
    m.refresh_from_db()
    assert m.total_cost == Decimal('1700.50')


def test_schedule_needs_an_interval(vehicle):
    cat = MaintenanceCategory.objects.create(name='Engine')
    violates(lambda: MaintenanceSchedule.objects.create(vehicle=vehicle, category=cat))


def test_notification_dedupe(django_user_model):
    u = django_user_model.objects.create_user('u1')
    Notification.objects.create(recipient=u, type='DOCUMENT_EXPIRY', title='t', message='m', dedupe_key='doc:1:30d')
    violates(lambda: Notification.objects.create(recipient=u, type='DOCUMENT_EXPIRY', title='t', message='m',
                                                 dedupe_key='doc:1:30d'))


def test_seed_reference_is_idempotent():
    call_command('seed_reference')
    call_command('seed_reference')
    from django.contrib.auth.models import Group
    assert set(Group.objects.values_list('name', flat=True)) >= {
        'System Administrator', 'Fleet Administrator', 'Field Office User', 'Viewer'}
    assert MaintenanceCategory.objects.count() == 9
    viewer = Group.objects.get(name='Viewer').permissions.values_list('codename', flat=True)
    assert viewer and all(c.startswith('view_') for c in viewer)
