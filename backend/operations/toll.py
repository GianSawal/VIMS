"""
RFID / toll rules. One place, so the API and the Excel import can't bypass them.

- An RFID account (Easytrip, Autosweep, ...) can be assigned to a vehicle or left unassigned in the motor pool.
- A toll transaction is either a load (credit) or a toll/charge (debit), never both, and amounts are non-negative.
- The account number is shown masked (last 4 only) to anyone who cannot change the account; no third-party
  passwords are stored at all (spec 5.8).
- Running balance is the cumulative credit - debit over an account's transactions in time order. It is
  computed, never typed.
"""
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone
from rest_framework import serializers

from accounts.permissions import scope_to_offices
from fleet.models import Vehicle

from .models import RFIDAccount, TollTransaction


def _fail(field, msg):
    raise serializers.ValidationError({field: [msg]})


def _money(v):
    return Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def mask_account(number):
    """'1234567890123' -> '•••• 0123'. Short numbers are fully masked."""
    n = (number or '').strip()
    return f'•••• {n[-4:]}' if len(n) > 4 else '•' * len(n)


def can_see_full(user):
    return user.has_perm('operations.change_rfidaccount')


# ---------------------------------------------------------------- accounts

def save_account(*, user, instance=None, data):
    if 'account_number' in data:
        data['account_number'] = data['account_number'].strip().upper()
    vehicle = data.get('vehicle', instance.vehicle if instance else None)
    if 'vehicle' in data and vehicle is not None:
        if not scope_to_offices(Vehicle.objects.filter(pk=vehicle.pk), user, 'office').exists():
            _fail('vehicle', 'You do not have access to this vehicle.')
        if vehicle.is_archived:
            _fail('vehicle', 'Archived vehicles cannot be assigned an RFID account.')
    provider = data.get('provider', instance.provider if instance else None)
    number = data.get('account_number', instance.account_number if instance else None)
    if RFIDAccount.objects.filter(provider=provider, account_number=number).exclude(pk=instance.pk if instance else None).exists():
        _fail('account_number', 'This provider already has an account with this number.')
    if instance is None:
        return RFIDAccount.objects.create(created_by=user, **data)
    for k, v in data.items():
        setattr(instance, k, v)
    instance.save()
    return instance


# ---------------------------------------------------------------- transactions

def save_transaction(*, user, instance=None, data):
    merged = {f: getattr(instance, f) for f in ('account', 'vehicle', 'trip', 'transacted_at', 'credit', 'debit')} if instance else {}
    merged.update(data)
    account, vehicle, trip = merged['account'], merged['vehicle'], merged.get('trip')
    credit, debit = merged.get('credit') or Decimal('0'), merged.get('debit') or Decimal('0')

    if not scope_to_offices(Vehicle.objects.filter(pk=vehicle.pk), user, 'office').exists():
        _fail('vehicle', 'You do not have access to this vehicle.')
    if account.vehicle_id and account.vehicle_id != vehicle.pk:
        _fail('vehicle', f'This account is assigned to {account.vehicle.plate_number}; use that vehicle or reassign the account.')
    if trip and trip.vehicle_id != vehicle.pk:
        _fail('trip', 'The trip is for a different vehicle.')
    if merged['transacted_at'] > timezone.now():
        _fail('transacted_at', 'The transaction time cannot be in the future.')
    if credit < 0 or debit < 0:
        _fail('credit', 'Amounts cannot be negative.')
    if credit and debit:
        _fail('debit', 'A transaction is either a load (credit) or a charge (debit), not both.')
    if not credit and not debit:
        _fail('credit', 'Enter a load (credit) or a charge (debit).')
    if 'credit' in data:
        data['credit'] = _money(credit)
    if 'debit' in data:
        data['debit'] = _money(debit)

    if instance is None:
        return TollTransaction.objects.create(created_by=user, **data)
    for k, v in data.items():
        setattr(instance, k, v)
    instance.save()
    return instance


def with_running_balance(transactions):
    """Attach `.running_balance` to each transaction of one account (oldest to newest), returned newest first."""
    rows = sorted(transactions, key=lambda x: (x.transacted_at, x.pk))
    total = Decimal('0')
    for x in rows:
        total += (x.credit or Decimal('0')) - (x.debit or Decimal('0'))
        x.running_balance = total
    return list(reversed(rows))
