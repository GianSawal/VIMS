"""Phase 6B: scheduled trips (odometer entered on the day) and the public TV display."""
import io
from datetime import datetime, time, timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Office
from audit.models import AuditLog
from fleet.models import Vehicle
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle
from operations.models import DisplayScreen, Trip

pytestmark = pytest.mark.django_db
TODAY = timezone.localdate()


def at(day_offset, hour, minute=0):
    """Aware datetime at local `hour:minute`, `day_offset` days from today."""
    return timezone.make_aware(datetime.combine(TODAY + timedelta(days=day_offset), time(hour, minute)))


@pytest.fixture(autouse=True)
def seed():
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


@pytest.fixture
def fo2():
    return Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')


@pytest.fixture
def vehicle(fo1):
    return make_vehicle(fo1, 'SCH 1', current_odometer=20000)


@pytest.fixture
def driver(fo1):
    return make_driver(fo1, 'Pedro', 'L-1')


def book(c, vehicle, driver, start, end=None, **kw):
    return c.post('/api/trips/schedule/', {
        'vehicle': vehicle.pk, 'driver': driver.pk, 'scheduled_departure': start.isoformat(),
        'scheduled_return': end.isoformat() if end else None, 'origin': 'RO', 'destination': 'Tarlac',
        'purpose': 'Inspection', **kw}, format='json')


def make_scheduled(vehicle, driver, start, end=None):
    """Bypass the 'must be in the future' rule to create today's/past bookings for testing the day rules."""
    t = Trip.objects.create(ticket_number=f'T-{Trip.objects.count() + 1}', status='SCHEDULED', vehicle=vehicle,
                            driver=driver, scheduled_departure=start, scheduled_return=end,
                            origin='RO', destination='Tarlac', purpose='Inspection')
    return t


def test_schedule_has_no_odometer_and_keeps_vehicle_free(vehicle, driver):
    c = as_role('Field Office User', [vehicle.office])
    r = book(c, vehicle, driver, at(2, 8), at(2, 17))
    assert r.status_code == 201, r.json()
    t = r.json()
    assert t['status'] == 'SCHEDULED' and t['schedule_day'] == 'UPCOMING'
    assert t['odometer_start'] is None and t['departed_at'] is None
    assert t['ticket_number'].startswith(f'TT-{at(2, 8):%Y}-')
    vehicle.refresh_from_db()
    assert vehicle.status == 'SERVICEABLE'  # booking ahead does not take the vehicle out of service
    assert AuditLog.objects.filter(action='trip_schedule').exists()


def test_schedule_must_be_future_and_return_after_departure(vehicle, driver):
    c = as_role('Fleet Administrator')
    assert 'scheduled_departure' in book(c, vehicle, driver, at(-1, 9)).json()
    assert 'scheduled_return' in book(c, vehicle, driver, at(2, 9), at(2, 8)).json()


def test_no_double_booking_of_vehicle_or_driver(vehicle, driver, fo1):
    c = as_role('Fleet Administrator')
    assert book(c, vehicle, driver, at(3, 8), at(3, 12)).status_code == 201
    other_driver, other_vehicle = make_driver(fo1, 'Juan', 'L-2'), make_vehicle(fo1, 'SCH 2')
    r = book(c, vehicle, other_driver, at(3, 10), at(3, 15))
    assert r.status_code == 400 and 'already booked' in r.json()['vehicle'][0]
    r = book(c, other_vehicle, driver, at(3, 11))
    assert r.status_code == 400 and 'already booked' in r.json()['driver'][0]
    # Back-to-back is fine; a booking without a return blocks the rest of that day.
    assert book(c, vehicle, other_driver, at(3, 12), at(3, 14)).status_code == 201
    assert book(c, other_vehicle, make_driver(fo1, 'Ana', 'L-3'), at(4, 8)).status_code == 201
    assert 'vehicle' in book(c, other_vehicle, other_driver, at(4, 20), at(4, 21)).json()


def test_unserviceable_vehicle_and_unlicensed_driver_cannot_be_booked(fo1, driver):
    c = as_role('Fleet Administrator')
    assert 'vehicle' in book(c, make_vehicle(fo1, 'BAD 1', status='UNSERVICEABLE'), driver, at(2, 8)).json()
    # In repair today is fine: it may be back by then.
    assert book(c, make_vehicle(fo1, 'REP 1', status='FOR_REPAIR'), driver, at(2, 8)).status_code == 201
    expiring = make_driver(fo1, 'Soon', 'L-9', days=1)
    assert 'expired' in str(book(c, make_vehicle(fo1, 'OK 1'), expiring, at(5, 8)).json())


def test_dispatch_only_on_the_scheduled_day_with_odometer(vehicle, driver):
    c = as_role('Field Office User', [vehicle.office])
    future = Trip.objects.get(pk=book(c, vehicle, driver, at(2, 8)).json()['id'])
    r = c.post(f'/api/trips/{future.pk}/dispatch/', {'odometer_start': 20000}, format='json')
    assert r.status_code == 400 and 'only be dispatched on that day' in str(r.json())

    missed = make_scheduled(vehicle, driver, at(-1, 8))
    r = c.post(f'/api/trips/{missed.pk}/dispatch/', {'odometer_start': 20000}, format='json')
    assert r.status_code == 400 and 'missed' in str(r.json())
    assert c.get(f'/api/trips/{missed.pk}/').json()['schedule_day'] == 'MISSED'

    today = make_scheduled(vehicle, driver, at(0, 0, 1))
    assert c.get(f'/api/trips/{today.pk}/').json()['schedule_day'] == 'TODAY'
    r = c.post(f'/api/trips/{today.pk}/dispatch/', {}, format='json')
    assert r.status_code == 400 and 'odometer_start' in r.json()  # odometer is required on the day
    r = c.post(f'/api/trips/{today.pk}/dispatch/', {'odometer_start': 19999}, format='json')
    assert 'odometer_start' in r.json()  # same history rule as direct dispatch
    r = c.post(f'/api/trips/{today.pk}/dispatch/', {'odometer_start': 20040}, format='json')
    assert r.status_code == 200, r.json()
    assert r.json()['status'] == 'DISPATCHED' and r.json()['odometer_start'] == 20040 and r.json()['departed_at']
    vehicle.refresh_from_db()
    assert vehicle.status == 'IN_USE'
    r = c.post(f'/api/trips/{today.pk}/complete/', {'returned_at': timezone.now().isoformat(), 'odometer_end': 20100},
               format='json')
    assert r.status_code == 200 and r.json()['distance_km'] == 60


def test_dispatch_on_the_day_still_checks_vehicle_availability(vehicle, driver):
    c = as_role('Fleet Administrator')
    t = make_scheduled(vehicle, driver, at(0, 0, 1))
    Vehicle.objects.filter(pk=vehicle.pk).update(status='UNDER_MAINTENANCE')
    r = c.post(f'/api/trips/{t.pk}/dispatch/', {'odometer_start': 20000}, format='json')
    assert r.status_code == 400 and 'vehicle' in r.json()


def test_reschedule_and_cancel_scheduled(vehicle, driver, fo1):
    c = as_role('Fleet Administrator')
    t = book(c, vehicle, driver, at(2, 8)).json()
    other = make_driver(fo1, 'Juan', 'L-2')
    r = c.post(f'/api/trips/{t["id"]}/reschedule/', {'vehicle': vehicle.pk, 'driver': other.pk,
                                                     'scheduled_departure': at(3, 9).isoformat()}, format='json')
    assert r.status_code == 200 and r.json()['driver_name'] == 'Juan'
    log = AuditLog.objects.get(action='trip_reschedule')
    assert log.changes['driver'] == ['Pedro', 'Juan']
    # rescheduling into a clash is rejected; its own old slot doesn't count as a clash
    clash = book(c, make_vehicle(fo1, 'SCH 9'), driver, at(5, 8)).json()
    r = c.post(f'/api/trips/{t["id"]}/reschedule/', {'vehicle': vehicle.pk, 'driver': driver.pk,
                                                     'scheduled_departure': at(5, 10).isoformat()}, format='json')
    assert r.status_code == 400 and clash['ticket_number'] in str(r.json())

    r = c.post(f'/api/trips/{t["id"]}/cancel/', {'reason': 'Event postponed'}, format='json')
    assert r.status_code == 200 and r.json()['status'] == 'CANCELLED'
    vehicle.refresh_from_db()
    assert vehicle.status == 'SERVICEABLE'


def test_scheduled_trips_in_filters_and_summary(vehicle, driver):
    c = as_role('Fleet Administrator')
    book(c, vehicle, driver, at(3, 8))
    assert c.get('/api/trips/?status=SCHEDULED').json()['count'] == 1
    assert c.get(f'/api/trips/?date_from={TODAY + timedelta(days=3)}').json()['count'] == 1
    assert c.get(f'/api/trips/?date_to={TODAY + timedelta(days=1)}').json()['count'] == 0
    assert c.get('/api/trips/summary/').json()['by_status']['SCHEDULED'] == 1


def test_permissions(vehicle, driver, fo2):
    assert book(as_role('Viewer'), vehicle, driver, at(2, 8)).status_code == 403
    fo = as_role('Field Office User', [vehicle.office])
    far = make_vehicle(fo2, 'FAR 1')
    assert 'vehicle' in book(fo, far, driver, at(2, 8)).json()
    t = make_scheduled(vehicle, driver, at(0, 0, 1))
    assert as_role('Viewer').post(f'/api/trips/{t.pk}/dispatch/', {'odometer_start': 20000}, format='json').status_code == 403


# ---------------------------------------------------------------- TV display

def display(token):
    return APIClient().get('/api/display/trips/', {'token': token})


def test_display_requires_active_token():
    assert display('').status_code == 403
    assert display('nope').status_code == 403
    s = DisplayScreen.objects.create(name='Lobby', is_active=False)
    assert display(s.token).status_code == 403


def test_display_shows_today_and_upcoming_without_sensitive_fields(vehicle, driver, fo1, fo2):
    other_driver = make_driver(fo1, 'Juan', 'L-2')
    today_booked = make_scheduled(vehicle, driver, at(0, 23, 50))
    out_now = Trip.objects.create(ticket_number='OUT-1', status='DISPATCHED', vehicle=make_vehicle(fo1, 'OUT 1'),
                                  driver=other_driver, departed_at=timezone.now() - timedelta(days=1),
                                  odometer_start=1, origin='RO', destination='Pampanga', purpose='Field monitoring',
                                  passengers='Someone Private', scheduled_return=timezone.now() - timedelta(hours=2))
    upcoming = make_scheduled(make_vehicle(fo1, 'UP 1'), make_driver(fo1, 'Ana', 'L-3'), at(3, 8))
    make_scheduled(make_vehicle(fo1, 'FAR 9'), make_driver(fo1, 'Far', 'L-4'), at(30, 8))     # beyond 7 days
    make_scheduled(make_vehicle(fo2, 'FO2 1'), make_driver(fo2, 'Other', 'L-5'), at(1, 8))    # other office

    screen = DisplayScreen.objects.create(name='FO1 lobby', office=fo1)
    r = display(screen.token)
    assert r.status_code == 200
    body = r.json()
    assert body['office']['code'] == 'FO1'
    assert {t['ticket_number'] for t in body['today']} == {today_booked.ticket_number, 'OUT-1'}
    assert [t['ticket_number'] for t in body['upcoming']] == [upcoming.ticket_number]
    row = next(t for t in body['today'] if t['ticket_number'] == 'OUT-1')
    assert row['flag'] == 'OVERDUE' and row['vehicle_photo_url'] is None
    assert row['purpose'] == 'Field monitoring'  # purpose is shown so viewers know why
    for t in body['today'] + body['upcoming']:
        assert not {'passengers', 'remarks', 'odometer_start', 'id', 'vehicle', 'driver'} & set(t)
    screen.refresh_from_db()
    assert screen.last_seen_at is not None

    all_offices = DisplayScreen.objects.create(name='RO lobby')
    assert any(t['office_code'] == 'FO2' for t in display(all_offices.token).json()['upcoming'])


def test_display_flags_delayed_departure(vehicle, driver):
    late = make_scheduled(vehicle, driver, timezone.now() - timedelta(minutes=30))
    if timezone.localtime(late.scheduled_departure).date() != TODAY:
        pytest.skip('just after midnight; the booking fell on yesterday')
    rows = display(DisplayScreen.objects.create(name='Lobby').token).json()['today']
    assert rows[0]['flag'] == 'DELAYED'


def test_dispatch_now_blocked_inside_someone_elses_booking(vehicle, driver, fo1):
    c = as_role('Fleet Administrator')
    now = timezone.now()
    booked = make_scheduled(vehicle, driver, now - timedelta(minutes=30), now + timedelta(hours=2))
    walk_in_driver, walk_in_vehicle = make_driver(fo1, 'Juan', 'L-2'), make_vehicle(fo1, 'SCH 2')
    body = {'origin': 'RO', 'destination': 'X', 'purpose': 'Errand', 'departed_at': now.isoformat(), 'odometer_start': 20000}
    r = c.post('/api/trips/', {**body, 'vehicle': vehicle.pk, 'driver': walk_in_driver.pk}, format='json')
    assert r.status_code == 400 and f'reserved for {booked.ticket_number}' in r.json()['vehicle'][0]
    r = c.post('/api/trips/', {**body, 'vehicle': walk_in_vehicle.pk, 'driver': driver.pk, 'odometer_start': 0}, format='json')
    assert r.status_code == 400 and 'reserved' in r.json()['driver'][0]
    # once the booking window is over, the vehicle is free for a walk-in trip
    booked.scheduled_return = now - timedelta(minutes=1)
    booked.scheduled_departure = now - timedelta(hours=3)
    booked.save()
    r = c.post('/api/trips/', {**body, 'vehicle': vehicle.pk, 'driver': walk_in_driver.pk}, format='json')
    assert r.status_code == 201, r.json()


def test_staff_can_list_tv_links_by_office(fo1, fo2):
    mine, other, everyone = (DisplayScreen.objects.create(name='FO1 TV', office=fo1),
                             DisplayScreen.objects.create(name='FO2 TV', office=fo2), DisplayScreen.objects.create(name='All'))
    names = lambda c: {s['name'] for s in c.get('/api/display-screens/').json()}
    assert names(as_role('Fleet Administrator')) == {'FO1 TV', 'FO2 TV', 'All'}
    assert as_role('Fleet Administrator').get('/api/display-screens/').json()[0]['token'] in {mine.token, other.token, everyone.token}
    assert as_role('Field Office User', offices=[fo1]).get('/api/display-screens/').status_code == 403  # no view_displayscreen
    assert APIClient().get('/api/display-screens/').status_code == 401
    assert as_role('Fleet Administrator').post('/api/display-screens/', {'name': 'x'}).status_code == 405  # manage in admin


def test_display_shows_active_and_returned_today_not_cancelled(vehicle, driver, fo1):
    now = timezone.now()
    returned = Trip.objects.create(ticket_number='BACK-1', status='COMPLETED', vehicle=vehicle, driver=driver, origin='RO',
                                   destination='Done', purpose='x', departed_at=now - timedelta(hours=3), returned_at=now - timedelta(minutes=5),
                                   odometer_start=1, odometer_end=20)
    Trip.objects.create(ticket_number='OLD-1', status='COMPLETED', vehicle=make_vehicle(fo1, 'OLD 1'), driver=make_driver(fo1, 'Ol', 'L-7'),
                        origin='RO', destination='Yesterday', purpose='x', departed_at=now - timedelta(days=2),
                        returned_at=now - timedelta(days=1, hours=20), odometer_start=1, odometer_end=20)  # returned before today
    cancelled = make_scheduled(make_vehicle(fo1, 'CXL 1'), make_driver(fo1, 'Cx', 'L-9'), now + timedelta(minutes=30))
    cancelled.status = 'CANCELLED'
    cancelled.save()
    booked = make_scheduled(make_vehicle(fo1, 'BKD 1'), make_driver(fo1, 'Bk', 'L-8'), now + timedelta(minutes=20))
    if timezone.localtime(booked.scheduled_departure).date() != TODAY:
        pytest.skip('just before midnight; the booking falls on tomorrow')
    rows = display(DisplayScreen.objects.create(name='Lobby').token).json()['today']
    # the booking and today's returned trip show; cancelled and trips returned before today do not
    assert {r['ticket_number'] for r in rows} == {booked.ticket_number, returned.ticket_number}
    assert rows[0]['driver_photo_url'] is None
