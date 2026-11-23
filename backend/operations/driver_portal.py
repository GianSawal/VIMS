"""
Driver accounts' home (role Driver, operations.drive_trip): their license, their vehicles' warnings, this month's
figures, and reporting a vehicle problem. A user with no driver record gets {"driver": null}.

Vehicles = the driver's current assignments plus the vehicle of any trip they are out on now.
"""
import os
import uuid

from django.contrib.contenttypes.models import ContentType
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import PasswordChangeNotRequired, require
from audit.services import log
from fleet.documents import expiry_state
from fleet.driver_serializers import check_upload
from fleet.models import Attachment, Vehicle, VehicleDocument
from maintenance import service as maintenance_service
from maintenance.models import MaintenanceCategory, MaintenanceSchedule
from maintenance.service import schedule_state
from notifications.models import Notification
from notifications.services import notify, recipients_for_office

from .models import Trip

DRIVER_PERMS = [require('operations.drive_trip'), PasswordChangeNotRequired]


def driver_of(user):
    return getattr(user, 'driver', None)  # reverse one-to-one: AttributeError subclass when unlinked


def my_vehicles(driver):
    return (Vehicle.objects.filter(Q(assignments__driver=driver, assignments__end_date__isnull=True)
                                   | Q(trips__driver=driver, trips__status=Trip.Status.DISPATCHED))
            .distinct().order_by('plate_number'))


class DriverHomeView(APIView):
    permission_classes = DRIVER_PERMS

    def get(self, request):
        d = driver_of(request.user)
        if d is None:
            return Response({'driver': None, 'vehicles': [], 'month': None})
        today = timezone.localdate()
        vehicles = list(my_vehicles(d))
        ids = [v.pk for v in vehicles]
        docs, schedules = {}, {}
        for doc in VehicleDocument.objects.filter(vehicle_id__in=ids, status=VehicleDocument.Status.ACTIVE, expiry_date__isnull=False):
            state = expiry_state(doc.expiry_date, today)
            if state['band'] not in ('VALID', 'NONE'):
                docs.setdefault(doc.vehicle_id, []).append({'type': doc.get_document_type_display(), 'expiry_date': doc.expiry_date,
                                                            'expired': state['band'] == 'EXPIRED', 'days_left': state['days_left']})
        by_id = {v.pk: v for v in vehicles}
        for sch in MaintenanceSchedule.objects.filter(vehicle_id__in=ids, is_active=True).select_related('category'):
            sch.vehicle = by_id[sch.vehicle_id]  # schedule_state reads the odometer; no query per row
            state = schedule_state(sch, today)
            if state['status'] in ('OVERDUE', 'DUE_SOON'):
                schedules.setdefault(sch.vehicle_id, []).append({'category': sch.category.name, **state})
        start, year_start = today.replace(day=1), today.replace(month=1, day=1)
        done = Trip.objects.filter(driver=d, status=Trip.Status.COMPLETED, departed_at__date__gte=year_start)
        totals = done.aggregate(trips=Count('id'), km=Sum('distance_km'),
                                month_trips=Count('id', filter=Q(departed_at__date__gte=start)),
                                month_km=Sum('distance_km', filter=Q(departed_at__date__gte=start)))
        return Response({
            'driver': {'id': d.pk, 'full_name': d.full_name, 'office_code': d.office.code, 'photo_url': d.photo.url if d.photo else None,
                       'employee_number': d.employee_number, 'contact_number': d.contact_number, 'office_name': d.office.name,
                       'username': request.user.username,
                       'license_number': d.license_number, 'license_type': d.get_license_type_display(),
                       'license_restrictions': d.license_restrictions, 'license_issue_date': d.license_issue_date,
                       'license_expiry_date': d.license_expiry_date, 'license_status': d.license_status(today),
                       'license_days_left': (d.license_expiry_date - today).days},
            'vehicles': [{'id': v.pk, 'plate_number': v.plate_number, 'label': f'{v.make} {v.model}'.strip(),
                          'photo_url': v.photo.url if v.photo else None, 'current_odometer': v.current_odometer,
                          'status': v.get_status_display(), 'fuel_type': v.fuel_type,
                          'documents': docs.get(v.pk, []), 'maintenance': schedules.get(v.pk, [])} for v in vehicles],
            'month': {'start': start, 'trips': totals['month_trips'], 'distance_km': totals['month_km'] or 0},
            'year': {'start': year_start, 'trips': totals['trips'], 'distance_km': totals['km'] or 0},
        })


class ReportProblemSerializer(serializers.Serializer):
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all())
    description = serializers.CharField(max_length=2000)
    photo = serializers.FileField(required=False)

    def validate_photo(self, f):
        return check_upload(f)


class ReportProblemView(APIView):
    """A driver reports a problem with one of their vehicles: it becomes a Scheduled maintenance record (category
    Other, for the office to inspect and plan) with the photo attached, and the office's maintenance staff are told."""
    permission_classes = DRIVER_PERMS
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        d = driver_of(request.user)
        if d is None:
            return Response({'detail': 'This login is not linked to a driver.'}, status=status.HTTP_403_FORBIDDEN)
        s = ReportProblemSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        vehicle, text, photo = s.validated_data['vehicle'], ' '.join(s.validated_data['description'].split()), s.validated_data.get('photo')
        if not my_vehicles(d).filter(pk=vehicle.pk).exists():
            raise serializers.ValidationError({'vehicle': ['Report problems only for a vehicle assigned to you or that you are driving.']})
        other = MaintenanceCategory.objects.get_or_create(name='Other')[0]
        with transaction.atomic():
            record = maintenance_service.save_record(user=request.user, categories=[other], data={
                'vehicle': vehicle, 'date': timezone.localdate(), 'odometer': vehicle.current_odometer,
                'description': f'Reported by driver {d.full_name}: {text}'})
            if photo:
                Attachment.objects.create(content_type=ContentType.objects.get_for_model(record), object_id=record.pk, file=photo,
                                          original_name=os.path.basename(photo.name)[:255], size=photo.size,
                                          description='Photo from the driver', uploaded_by=request.user)
        log(request, 'create', record, f'Driver {d.full_name} reported a problem with {vehicle.plate_number}',
            {'after': {'description': text, 'photo': bool(photo)}})
        staff = get_user_model().objects.with_perm('maintenance.change_maintenancerecord', is_active=True)
        notify(recipients_for_office(vehicle.office).filter(pk__in=staff.values('pk')), type=Notification.Type.VEHICLE_ISSUE,
               title=f'Problem reported: {vehicle.plate_number}', message=f'{d.full_name}: {text[:300]}',
               dedupe_key=f'issue:{record.pk}', related=record)
        return Response({'id': record.pk}, status=status.HTTP_201_CREATED)


class CorrectionSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000)


class RequestCorrectionView(APIView):
    """A driver asks the office to fix their profile (phone number, renewed license...). Drivers cannot edit their own
    record; this notifies the staff who can (fleet.change_driver in the driver's office) and is audited."""
    permission_classes = DRIVER_PERMS

    def post(self, request):
        d = driver_of(request.user)
        if d is None:
            return Response({'detail': 'This login is not linked to a driver.'}, status=status.HTTP_403_FORBIDDEN)
        s = CorrectionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        text = ' '.join(s.validated_data['message'].split())
        if not text:
            raise serializers.ValidationError({'message': ['Say what needs correcting.']})
        staff = get_user_model().objects.with_perm('fleet.change_driver', is_active=True)
        notify(recipients_for_office(d.office).filter(pk__in=staff.values('pk')), type=Notification.Type.DRIVER_UPDATE,
               title=f'Profile correction: {d.full_name}', message=text[:500],
               dedupe_key=f'correction:{d.pk}:{uuid.uuid4().hex[:12]}', related=d)
        log(request, 'driver_correction', d, f'Driver {d.full_name} asked for a profile correction', {'after': {'message': text}})
        return Response(status=status.HTTP_204_NO_CONTENT)
