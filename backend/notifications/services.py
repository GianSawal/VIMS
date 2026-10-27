"""
Notification generation and the small helpers the API uses.

generate() is idempotent: the (recipient, dedupe_key) unique constraint plus bulk_create(ignore_conflicts)
means re-running it never duplicates an alert. A new band (e.g. 30 -> 15 days) is a new key, so it alerts once
per threshold. Run it on a schedule with `manage.py run_notifications`.
"""
from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone

from accounts.permissions import VIEW_ALL_OFFICES
from fleet.documents import expiry_state
from fleet.models import Driver, VehicleDocument
from maintenance.models import MaintenanceSchedule
from maintenance.service import schedule_state

from .models import Notification

User = get_user_model()
T = Notification.Type

# Document type -> notification type (anything else is a generic DOCUMENT_EXPIRY).
_DOC_TYPE = {
    VehicleDocument.Type.LTO_REGISTRATION: T.LTO_RENEWAL,
    VehicleDocument.Type.GSIS_INSURANCE: T.INSURANCE_EXPIRY,
    VehicleDocument.Type.INSURANCE_POLICY: T.INSURANCE_EXPIRY,
}


def recipients_for_office(office):
    """Active users who can see this office: its members plus anyone with view_all_offices (incl. superusers)."""
    members = User.objects.filter(offices=office, is_active=True)
    return (members | User.objects.with_perm(VIEW_ALL_OFFICES, is_active=True)).distinct()


def notify(recipients, *, type, title, message, dedupe_key, related=None):
    """Create one notification per recipient, skipping any that already exist (same recipient + dedupe_key)."""
    ct = ContentType.objects.get_for_model(related) if related is not None else None
    oid = related.pk if related is not None else None
    rows = [Notification(recipient=u, type=type, title=title, message=message,
                         content_type=ct, object_id=oid, dedupe_key=dedupe_key) for u in recipients]
    Notification.objects.bulk_create(rows, ignore_conflicts=True)


def generate(today=None):
    """Scan documents, driver licenses and maintenance schedules; raise any new threshold alerts. Returns a count."""
    today = today or timezone.localdate()
    before = Notification.objects.count()
    cache = {}

    def recips(office):
        if office.pk not in cache:
            cache[office.pk] = list(recipients_for_office(office))
        return cache[office.pk]

    # --- documents (LTO / OR / GSIS / insurance ...) ---
    for d in (VehicleDocument.objects.filter(status=VehicleDocument.Status.ACTIVE, expiry_date__isnull=False)
              .select_related('vehicle', 'vehicle__office')):
        band = expiry_state(d.expiry_date, today)['band']
        if band in ('VALID', 'NONE'):
            continue
        label, plate, when = d.get_document_type_display(), d.vehicle.plate_number, f'{d.expiry_date:%b %d, %Y}'
        if band == 'EXPIRED':
            title, message = f'{label} expired', f'{plate}: {label} expired on {when}.'
        else:
            title, message = f'{label} expiring', f'{plate}: {label} expires on {when} (in {band} days or less).'
        notify(recips(d.vehicle.office), type=_DOC_TYPE.get(d.document_type, T.DOCUMENT_EXPIRY),
               title=title, message=message, dedupe_key=f'doc:{d.pk}:{band}', related=d)

    # --- driver licenses ---
    for drv in Driver.objects.filter(is_active=True).select_related('office'):
        band = drv.license_status(today)  # VALID / EXPIRING / EXPIRED
        if band == 'VALID':
            continue
        when = f'{drv.license_expiry_date:%b %d, %Y}'
        verb = 'expired on' if band == 'EXPIRED' else 'expires on'
        notify(recips(drv.office), type=T.LICENSE_EXPIRY,
               title=f"Driver's license {'expired' if band == 'EXPIRED' else 'expiring'}",
               message=f'{drv.full_name}: license {verb} {when}.',
               dedupe_key=f'lic:{drv.pk}:{band}', related=drv)

    # --- maintenance schedules (due soon / overdue) ---
    for sch in (MaintenanceSchedule.objects.filter(is_active=True)
                .select_related('vehicle', 'vehicle__office', 'category')):
        state = schedule_state(sch, today)
        status = state['status']
        if status not in ('DUE_SOON', 'OVERDUE'):
            continue
        bits = []
        if state['due_date']:
            bits.append(f'due {state["due_date"]:%b %d, %Y}')
        if state['due_odometer'] is not None:
            bits.append(f'at {state["due_odometer"]:,} km')
        notify(recips(sch.vehicle.office),
               type=T.MAINTENANCE_OVERDUE if status == 'OVERDUE' else T.MAINTENANCE_DUE,
               title=f'{sch.category.name} {"overdue" if status == "OVERDUE" else "due soon"}',
               message=f'{sch.vehicle.plate_number}: {sch.category.name} {" ".join(bits) or "is due"}.',
               dedupe_key=f'maint:{sch.pk}:{status}', related=sch)

    return Notification.objects.count() - before
