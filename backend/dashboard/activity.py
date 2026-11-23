"""
Recent-activity entries, built from the office-scoped records themselves (the audit log has no office and is
System Administrator only). Used by the dashboard (all of the user's offices) and by one vehicle's Activity tab.
Each builder returns at most `limit` entries, newest first; callers merge and sort them with `merge()`.
"""
from fleet.models import Vehicle, VehicleAssignment, VehicleDocument
from maintenance.models import MaintenanceRecord
from operations.models import FuelRecord, Trip

TRIP_VERB = {'SCHEDULED': 'Trip scheduled to', 'DISPATCHED': 'Dispatched to', 'COMPLETED': 'Returned from', 'CANCELLED': 'Trip cancelled to'}


def vehicles(qs, limit):
    return [{'kind': 'vehicle', 'at': v.created_at, 'link': f'/vehicles/{v.id}', 'plate_number': v.plate_number,
             'text': f'Vehicle added: {v.make} {v.model}'} for v in qs.order_by('-created_at')[:limit]]


def assignments(qs, limit):
    return [{'kind': 'assignment', 'at': a.created_at, 'link': f'/vehicles/{a.vehicle_id}?tab=assignments', 'plate_number': a.vehicle.plate_number,
             'text': f'Assigned to {a.accountable_person} ({a.office.code})' + (f', driver {a.driver_name}' if a.driver_name else '')}
            for a in qs.select_related('vehicle', 'office').order_by('-created_at')[:limit]]


def documents(qs, limit):
    return [{'kind': 'document', 'at': d.created_at, 'link': f'/documents/{d.id}', 'plate_number': d.vehicle.plate_number,
             'text': f'{d.get_document_type_display()} recorded' + (f', expires {d.expiry_date:%b %d, %Y}' if d.expiry_date else '')}
            for d in qs.select_related('vehicle').order_by('-created_at')[:limit]]


def fuel(qs, limit):
    return [{'kind': 'fuel', 'at': r.created_at, 'link': f'/fuel/{r.id}', 'plate_number': r.vehicle.plate_number,
             'text': f'Fuel: {r.liters.normalize():f} L, ₱{r.total_amount:,.2f}'}
            for r in qs.select_related('vehicle').order_by('-created_at')[:limit]]


def maintenance(qs, limit):
    return [{'kind': 'maintenance', 'at': r.updated_at, 'link': f'/maintenance/{r.id}', 'plate_number': r.vehicle.plate_number,
             'text': f'Maintenance {r.get_status_display().lower()}: {r.description[:60]}'}
            for r in qs.select_related('vehicle').order_by('-updated_at')[:limit]]


def trips(qs, limit):
    return [{'kind': 'trip', 'at': t.updated_at, 'link': f'/trips/{t.id}', 'plate_number': t.vehicle.plate_number,
             'text': f'{TRIP_VERB[t.status]} {t.destination}'}
            for t in qs.select_related('vehicle').order_by('-updated_at')[:limit]]


def merge(parts, limit):
    return sorted((e for p in parts for e in p), key=lambda a: a['at'], reverse=True)[:limit]


def for_vehicle(user, v, limit):
    """One vehicle's feed: only the record types the user may view (the vehicle itself is already office-checked)."""
    parts = [vehicles(Vehicle.objects.filter(pk=v.pk), 1)]
    for perm, build, model in [
        ('fleet.view_vehicleassignment', assignments, VehicleAssignment),
        ('fleet.view_vehicledocument', documents, VehicleDocument),
        ('operations.view_fuelrecord', fuel, FuelRecord),
        ('maintenance.view_maintenancerecord', maintenance, MaintenanceRecord),
        ('operations.view_trip', trips, Trip),
    ]:
        if user.has_perm(perm):
            parts.append(build(model.objects.filter(vehicle=v), limit))
    return merge(parts, limit)
