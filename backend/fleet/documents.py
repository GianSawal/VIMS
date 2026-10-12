"""
Vehicle document rules (LTO registration, OR/CR, GSIS/insurance, ...). One place, so the API and the Excel
import can't bypass them.

Lifecycle:  ACTIVE -> SUPERSEDED   by renew(): a new ACTIVE row is created, the old one is kept as history.
            ACTIVE -> CANCELLED    by cancel(): a wrong entry. Both end states are final (only remarks change).
Vehicle and type never change after creation; a renewal is always the same vehicle and type.

Some types hold one current document per vehicle (SINGLE_ACTIVE): add the first one, renew it after that.
Expiring types need an expiry date (EXPIRING_TYPES).

Expiry bands for ACTIVE documents (thresholds = settings.DOCUMENT_ALERT_DAYS, default 60/30/15/7):
    EXPIRED   expiry date has passed (expiring today still counts as valid today)
    7 / 15 / 30 / 60   expires within that many days (the smallest threshold that applies)
    VALID     more than the largest threshold away
    NONE      no expiry date
The band is also the alert level: Phase 11 sends one notification per document and band ("doc:<id>:<band>").
"""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from accounts.permissions import scope_to_offices

from .models import Vehicle, VehicleDocument

T = VehicleDocument.Type
S = VehicleDocument.Status
EXPIRING_TYPES = {T.LTO_REGISTRATION, T.OFFICIAL_RECEIPT, T.GSIS_INSURANCE, T.INSURANCE_POLICY}
SINGLE_ACTIVE = EXPIRING_TYPES | {T.CERTIFICATE_OF_REGISTRATION}
EDITABLE = ('reference_number', 'issue_date', 'expiry_date', 'file', 'remarks')


def _fail(field, msg):
    raise serializers.ValidationError({field: [msg]})


def thresholds():
    return settings.DOCUMENT_ALERT_DAYS  # largest first


def bands():
    return ['EXPIRED', *[str(d) for d in reversed(thresholds())], 'VALID', 'NONE']


def expiry_state(expiry_date, today=None):
    """{'band', 'days_left'} for one expiry date (see module docstring)."""
    if expiry_date is None:
        return {'band': 'NONE', 'days_left': None}
    days_left = (expiry_date - (today or timezone.localdate())).days
    if days_left < 0:
        return {'band': 'EXPIRED', 'days_left': days_left}
    within = [d for d in thresholds() if days_left <= d]
    return {'band': str(min(within)) if within else 'VALID', 'days_left': days_left}


def band_filter(band, today=None):
    """Q() selecting the documents whose expiry date falls in `band` (same edges as expiry_state)."""
    today = today or timezone.localdate()
    days = sorted(thresholds())
    if band == 'NONE':
        return Q(expiry_date__isnull=True)
    if band == 'EXPIRED':
        return Q(expiry_date__lt=today)
    if band == 'VALID':
        return Q(expiry_date__gt=today + timedelta(days=days[-1]))
    d = int(band)
    lower = max([x for x in days if x < d], default=-1)  # previous threshold; -1 so the first band starts today
    return Q(expiry_date__gt=today + timedelta(days=lower), expiry_date__lte=today + timedelta(days=d))


def _check_dates(doc_type, issue, expiry):
    if doc_type in EXPIRING_TYPES and expiry is None:
        _fail('expiry_date', 'This document type needs an expiry date.')
    if issue and expiry and expiry < issue:
        _fail('expiry_date', 'Expiry date cannot be before the issue date.')
    if issue and issue > timezone.localdate():
        _fail('issue_date', 'Issue date cannot be in the future.')


def _check_vehicle(user, vehicle):
    if not scope_to_offices(Vehicle.objects.filter(pk=vehicle.pk), user, 'office').exists():
        _fail('vehicle', 'You do not have access to this vehicle.')
    if vehicle.is_archived:
        _fail('vehicle', 'Archived vehicles cannot get new documents. Restore the vehicle first.')


def _replace_file(doc, new_file):
    """Swap the stored file; the old one is deleted only after the transaction commits."""
    old = doc.file.name if doc.file else None
    doc.file = new_file
    if old:
        storage = doc.file.storage
        transaction.on_commit(lambda: storage.delete(old))


def create(*, user, data):
    vehicle, doc_type = data['vehicle'], data['document_type']
    _check_vehicle(user, vehicle)
    _check_dates(doc_type, data.get('issue_date'), data.get('expiry_date'))
    with transaction.atomic():
        Vehicle.objects.select_for_update().get(pk=vehicle.pk)  # serialize "one active per type" checks
        if doc_type in SINGLE_ACTIVE and VehicleDocument.objects.filter(
                vehicle=vehicle, document_type=doc_type, status=S.ACTIVE).exists():
            _fail('document_type', f'{vehicle.plate_number} already has a current {T(doc_type).label}. Renew it instead.')
        return VehicleDocument.objects.create(created_by=user, **{**data, 'status': S.ACTIVE})


def update(doc, *, data):
    if doc.status != S.ACTIVE:
        if set(data) - {'remarks'}:
            raise serializers.ValidationError(f'{doc.get_status_display()} documents are history; only remarks can change.')
    unknown = set(data) - set(EDITABLE)
    if unknown:
        raise serializers.ValidationError(f'{", ".join(sorted(unknown))} cannot change. Cancel this document and add a new one.')
    _check_dates(doc.document_type, data.get('issue_date', doc.issue_date), data.get('expiry_date', doc.expiry_date))
    with transaction.atomic():
        if 'file' in data:
            _replace_file(doc, data.pop('file'))
        for k, v in data.items():
            setattr(doc, k, v)
        doc.save()
    return doc


def renew(doc, *, user, data):
    """New ACTIVE document for the same vehicle and type; the old one becomes SUPERSEDED (history kept)."""
    _check_dates(doc.document_type, data.get('issue_date'), data.get('expiry_date'))
    with transaction.atomic():
        Vehicle.objects.select_for_update().get(pk=doc.vehicle_id)
        doc = VehicleDocument.objects.select_for_update().get(pk=doc.pk)
        if doc.status != S.ACTIVE:
            raise serializers.ValidationError(f'Only the current document can be renewed; this one is {doc.get_status_display().lower()}.')
        new_expiry = data.get('expiry_date')
        if doc.expiry_date and new_expiry and new_expiry <= doc.expiry_date:
            _fail('expiry_date', f'The renewed document must expire after the current one ({doc.expiry_date:%b %d, %Y}).')
        doc.status = S.SUPERSEDED
        doc.save(update_fields=['status', 'updated_at'])
        return VehicleDocument.objects.create(vehicle=doc.vehicle, document_type=doc.document_type, created_by=user,
                                              status=S.ACTIVE, **data), doc


def cancel(doc, *, reason):
    with transaction.atomic():
        doc = VehicleDocument.objects.select_for_update().get(pk=doc.pk)
        if doc.status != S.ACTIVE:
            raise serializers.ValidationError(f'This document is already {doc.get_status_display().lower()}.')
        doc.status = S.CANCELLED
        note = f'Cancelled: {reason}'
        doc.remarks = f'{doc.remarks}\n{note}'.strip()
        doc.save(update_fields=['status', 'remarks', 'updated_at'])
    return doc
