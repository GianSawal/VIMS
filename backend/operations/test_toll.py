"""Phase 10: RFID / toll accounts (masking, assignment) and toll transactions (credit/debit, running balance)."""
import io
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Office
from audit.models import AuditLog
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle
from operations.models import RFIDAccount, TollTransaction, Trip

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def seed():
    call_command('seed_reference', stdout=io.StringIO())


@pytest.fixture
def fo1():
    return Office.objects.create(code='FO1', name='Field Office 1', office_type='FIELD')


def account(**kw):
    return {'provider': 'EASYTRIP', 'account_number': ' easy-1234567890 ', **kw}


def txn(acc, veh, **kw):
    base = {'account': acc, 'vehicle': veh, 'transacted_at': timezone.now().isoformat(),
            'description': 'NLEX Balintawak', 'reference_number': 'r1'}
    return {**base, **kw}


def test_account_created_normalized_and_number_masked_for_view_only(fo1):
    v = make_vehicle(fo1, 'RFD 1')
    admin = as_role('Fleet Administrator')
    r = admin.post('/api/rfid-accounts/', account(vehicle=v.pk, balance='500.00'), format='json')
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body['account_number'] == 'EASY-1234567890' and body['masked_account'] == '•••• 7890'  # admin sees full
    pk = body['id']
    # duplicate provider + number is rejected
    assert admin.post('/api/rfid-accounts/', account(), format='json').status_code == 400
    # a view-only user (Viewer) sees the masked number, never the full one
    viewer = as_role('Viewer').get(f'/api/rfid-accounts/{pk}/').json()
    assert viewer['account_number'] == '•••• 7890' and viewer['masked_account'] == '•••• 7890'
    assert AuditLog.objects.filter(action='create', entity_type='operations.RFIDAccount').count() == 1
    # the audit log never stores the full number
    assert '1234567890' not in str(AuditLog.objects.get(entity_type='operations.RFIDAccount').changes)


def test_credit_and_debit_rules_and_running_balance(fo1):
    v = make_vehicle(fo1, 'RFD 2')
    c = as_role('Fleet Administrator')
    acc = RFIDAccount.objects.create(provider='AUTOSWEEP', account_number='AS-9', vehicle=v)
    now = timezone.now()
    # load 1000, then two charges
    assert c.post('/api/toll-transactions/', txn(acc.pk, v.pk, transacted_at=(now - timedelta(hours=3)).isoformat(),
                                                 description='Load', credit='1000'), format='json').status_code == 201
    assert c.post('/api/toll-transactions/', txn(acc.pk, v.pk, transacted_at=(now - timedelta(hours=2)).isoformat(), debit='55.50'), format='json').status_code == 201
    assert c.post('/api/toll-transactions/', txn(acc.pk, v.pk, transacted_at=(now - timedelta(hours=1)).isoformat(), debit='120'), format='json').status_code == 201
    # a transaction can't be both a load and a charge, nor neither
    assert c.post('/api/toll-transactions/', txn(acc.pk, v.pk, credit='10', debit='5'), format='json').status_code == 400
    assert c.post('/api/toll-transactions/', txn(acc.pk, v.pk), format='json').status_code == 400
    assert c.post('/api/toll-transactions/', txn(acc.pk, v.pk, debit='-5'), format='json').status_code == 400
    assert c.post('/api/toll-transactions/', txn(acc.pk, v.pk, credit='10', transacted_at=(now + timedelta(hours=1)).isoformat()), format='json').status_code == 400

    body = c.get(f'/api/rfid-accounts/{acc.pk}/transactions/').json()
    assert body['credit'] == '1000.00' and body['debit'] == '175.50' and body['net'] == '824.50'
    # newest first, running balance cumulative in time order
    assert [row['running_balance'] for row in body['results']] == ['824.50', '944.50', '1000.00']


def test_transaction_vehicle_must_match_assigned_account_and_trip(fo1):
    v1, v2 = make_vehicle(fo1, 'RFD 3'), make_vehicle(fo1, 'RFD 4')
    c = as_role('Fleet Administrator')
    acc = RFIDAccount.objects.create(provider='EASYTRIP', account_number='E-ASSIGNED', vehicle=v1)
    r = c.post('/api/toll-transactions/', txn(acc.pk, v2.pk, credit='100'), format='json')
    assert r.status_code == 400 and 'assigned to' in str(r.json())
    assert c.post('/api/toll-transactions/', txn(acc.pk, v1.pk, credit='100'), format='json').status_code == 201


def test_summary_and_filters(fo1):
    fo2 = Office.objects.create(code='FO2', name='Field Office 2', office_type='FIELD')
    v1, v2 = make_vehicle(fo1, 'SUM 1'), make_vehicle(fo2, 'SUM 2')
    c = as_role('Fleet Administrator')
    a1 = RFIDAccount.objects.create(provider='EASYTRIP', account_number='E1', vehicle=v1)
    a2 = RFIDAccount.objects.create(provider='AUTOSWEEP', account_number='A2', vehicle=v2)
    c.post('/api/toll-transactions/', txn(a1.pk, v1.pk, credit='500'), format='json')
    c.post('/api/toll-transactions/', txn(a1.pk, v1.pk, debit='80'), format='json')
    c.post('/api/toll-transactions/', txn(a2.pk, v2.pk, debit='30'), format='json')
    s = c.get('/api/toll-transactions/summary/').json()
    assert s == {'total': 3, 'credit': '500.00', 'debit': '110.00', 'net': '390.00'}
    assert c.get('/api/toll-transactions/summary/', {'kind': 'debit'}).json()['total'] == 2
    assert c.get('/api/toll-transactions/', {'vehicle': v1.pk}).json()['count'] == 2

    # office scope: an FO1 user sees FO1 toll only, and unassigned accounts but not FO2's
    unassigned = RFIDAccount.objects.create(provider='OTHER', account_number='POOL-1')
    fou = as_role('Field Office User', offices=[fo1])
    assert fou.get('/api/toll-transactions/').json()['count'] == 2  # only FO1's
    ids = {a['id'] for a in fou.get('/api/rfid-accounts/').json()['results']}
    assert a1.pk in ids and unassigned.pk in ids and a2.pk not in ids  # own office + pool, not FO2
    assert fou.get(f'/api/rfid-accounts/{a2.pk}/').status_code == 404


def test_no_delete_and_field_user_cannot_add_account(fo1):
    v = make_vehicle(fo1, 'RFD 9')
    acc = RFIDAccount.objects.create(provider='EASYTRIP', account_number='E-ND', vehicle=v)
    c = as_role('Fleet Administrator')
    assert c.delete(f'/api/rfid-accounts/{acc.pk}/').status_code in (403, 405)
    assert c.delete(f'/api/toll-transactions/1/').status_code in (403, 404, 405)
    fou = as_role('Field Office User', offices=[fo1])
    assert fou.post('/api/rfid-accounts/', account(vehicle=v.pk), format='json').status_code == 403  # view only
    assert fou.post('/api/toll-transactions/', txn(acc.pk, v.pk, credit='10'), format='json').status_code == 201  # may add toll


def test_trip_ticket_shows_toll_and_account_live_balance(fo1):
    v = make_vehicle(fo1, 'TRP 1', current_odometer=1000)
    c = as_role('Fleet Administrator')
    acc = RFIDAccount.objects.create(provider='EASYTRIP', account_number='E-TRIP', vehicle=v)
    trip = Trip.objects.create(ticket_number='T-TOLL-1', status='DISPATCHED', vehicle=v, driver=make_driver(fo1, 'Dan', 'L-1'),
                               origin='RO', destination='NLEX', purpose='x', departed_at=timezone.now(), odometer_start=1000)
    c.post('/api/toll-transactions/', txn(acc.pk, v.pk, credit='1000'), format='json')  # load, not on the trip
    c.post('/api/toll-transactions/', txn(acc.pk, v.pk, debit='78', trip=trip.pk), format='json')
    c.post('/api/toll-transactions/', txn(acc.pk, v.pk, debit='92', trip=trip.pk), format='json')
    # the trip ticket shows the toll charged on it
    t = c.get(f'/api/trips/{trip.pk}/').json()
    assert t['toll'] == {'count': 2, 'charges': '170.00', 'loads': '0.00', 'net': '-170.00'}
    assert c.get('/api/toll-transactions/', {'trip': trip.pk}).json()['count'] == 2
    # the account's live balance = loads - charges
    assert c.get(f'/api/rfid-accounts/{acc.pk}/').json()['current_balance'] == '830.00'
    assert c.get(f'/api/rfid-accounts/{acc.pk}/transactions/').json()['current_balance'] == '830.00'
