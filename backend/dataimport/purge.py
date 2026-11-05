"""Delete test data before go-live (System Administrator only). Vehicles, drivers, offices, users, categories and
display screens are never touched; the audit log is append-only and keeps its history.

Each group lists models in delete order (children first). Attachments and stored files of deleted records go too."""
from django.contrib.contenttypes.models import ContentType
from django.db import transaction

from fleet.models import Attachment, Vehicle, VehicleAssignment, VehicleDocument
from maintenance.models import MaintenanceRecord, MaintenanceSchedule
from notifications.models import Notification
from operations.models import FuelRecord, RFIDAccount, TollTransaction, Trip, VehicleRequest

# key -> (label, models deleted). 'odometers' deletes nothing; it resets readings (see purge()).
GROUPS = {
    'trips': ('Trips and vehicle requests', [VehicleRequest, Trip]),
    'fuel': ('Fuel records', [FuelRecord]),
    'tolls': ('Toll transactions (loads and charges)', [TollTransaction]),
    'rfid': ('RFID accounts (and their toll transactions)', [TollTransaction, RFIDAccount]),
    'maintenance': ('Maintenance records (schedules restart from no service)', [MaintenanceRecord]),
    'assignments': ('Vehicle assignments', [VehicleAssignment]),
    'documents': ('Vehicle documents (registration, insurance, ...)', [VehicleDocument]),
    'notifications': ('Notifications', [Notification]),
    'odometers': ('Reset every vehicle odometer to 0', []),
}


def counts():
    out = {key: sum(m.objects.count() for m in dict.fromkeys(models)) for key, (_, models) in GROUPS.items()}
    out['odometers'] = Vehicle.objects.exclude(current_odometer=0).count()
    return out


def _delete_files(qs, field):
    paths = [p for p in qs.values_list(field, flat=True) if p]
    if paths:
        storage = qs.model._meta.get_field(field).storage
        transaction.on_commit(lambda: [storage.delete(p) for p in paths])


@transaction.atomic
def purge(keys):
    """Delete the chosen groups; returns {model label: rows deleted}. Vehicles left 'In use' or 'Under maintenance'
    by deleted trips/maintenance go back to Serviceable."""
    models = list(dict.fromkeys(m for k in keys for m in GROUPS[k][1]))
    deleted = {}
    for model in models:
        qs = model.objects.all()
        attachments = Attachment.objects.filter(content_type=ContentType.objects.get_for_model(model))
        _delete_files(attachments, 'file')
        if model is VehicleDocument:
            _delete_files(qs, 'file')
        for label, n in [*attachments.delete()[1].items(), *qs.delete()[1].items()]:
            deleted[label] = deleted.get(label, 0) + n
    if 'trips' in keys:
        Vehicle.objects.filter(status=Vehicle.Status.IN_USE).update(status=Vehicle.Status.SERVICEABLE)
    if 'maintenance' in keys:
        Vehicle.objects.filter(status=Vehicle.Status.UNDER_MAINTENANCE).update(status=Vehicle.Status.SERVICEABLE)
        MaintenanceSchedule.objects.update(last_service_date=None, last_service_odometer=None)
    if 'odometers' in keys:
        deleted['odometers reset'] = Vehicle.objects.exclude(current_odometer=0).update(current_odometer=0)
    return {k: n for k, n in deleted.items() if n}
