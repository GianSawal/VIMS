from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from accounts.permissions import OfficeScopedMixin, PasswordChangeNotRequired, require
from audit.services import diff, log

from . import assignments as assignment_service
from .driver_serializers import AssignInputSerializer, AssignmentSerializer, EndAssignmentSerializer
from .models import Vehicle
from .serializers import PhotoSerializer, VehicleDetailSerializer, VehicleSerializer

CAN_CHANGE = [require('fleet.change_vehicle'), PasswordChangeNotRequired]
CAN_VIEW_ASSIGNMENTS = [require('fleet.view_vehicleassignment'), PasswordChangeNotRequired]
CAN_PHOTO = [require('fleet.change_vehicle', 'fleet.manage_vehicle_photo'), PasswordChangeNotRequired]

AUDITED = ['plate_number', 'property_number', 'engine_number', 'chassis_number', 'office', 'status',
           'current_odometer', 'acquisition_cost', 'acquisition_date', 'make', 'model', 'vehicle_type']


def snapshot(v):
    return {f: str(getattr(v, f'{f}_id' if f == 'office' else f)) for f in AUDITED}


class VehicleViewSet(OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                     mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Vehicle master records. No DELETE: vehicles are archived so history and reports stay intact.
    Archived vehicles are hidden from the list unless `?is_archived=true` (or `?include_archived=1`).
    """
    queryset = Vehicle.objects.select_related('office')
    search_fields = ['plate_number', 'property_number', 'engine_number', 'chassis_number', 'make', 'model', 'variant']
    filterset_fields = ['status', 'office', 'vehicle_type', 'fuel_type', 'is_archived']
    ordering_fields = ['plate_number', 'make', 'model', 'year_model', 'current_odometer', 'status', 'updated_at']

    def get_serializer_class(self):
        if self.action == 'photo':
            return PhotoSerializer
        return VehicleSerializer if self.action == 'list' else VehicleDetailSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if self.action in ('list', 'summary') and 'is_archived' not in p and not p.get('include_archived'):
            qs = qs.filter(is_archived=False)
        return qs

    def perform_create(self, serializer):
        v = super().perform_create(serializer)
        log(self.request, 'create', v, f'Created vehicle {v}', {'after': snapshot(v)})

    def perform_update(self, serializer):
        before = snapshot(serializer.instance)
        old_odo = serializer.instance.current_odometer
        v = super().perform_update(serializer)
        changes = diff(before, snapshot(v))
        action_name = 'odometer_correction' if v.current_odometer < old_odo else 'update'
        if changes:
            log(self.request, action_name, v, f'Updated vehicle {v}', changes)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Counts per status for the same filters as the list (send everything except `status` to power status cards)."""
        rows = self.filter_queryset(self.get_queryset()).order_by().values('status').annotate(n=Count('id'))
        by_status = {r['status']: r['n'] for r in rows}
        return Response({'total': sum(by_status.values()), 'by_status': by_status})

    @action(detail=True, methods=['post'], permission_classes=CAN_CHANGE)
    def archive(self, request, pk=None):
        v = self.get_object()
        if v.is_archived:
            raise serializers.ValidationError('Vehicle is already archived.')
        v.is_archived, v.archived_at = True, timezone.now()
        v.save(update_fields=['is_archived', 'archived_at', 'updated_at'])
        log(request, 'archive', v, f'Archived vehicle {v}')
        return Response(VehicleDetailSerializer(v, context={'request': request}).data)

    @action(detail=True, methods=['post'], permission_classes=CAN_CHANGE)
    def reactivate(self, request, pk=None):
        v = self.get_object()
        if not v.is_archived:
            raise serializers.ValidationError('Vehicle is not archived.')
        if Vehicle.objects.filter(plate_number=v.plate_number, is_archived=False).exists():
            raise serializers.ValidationError('Another active vehicle now uses this plate number.')
        v.is_archived, v.archived_at = False, None
        v.save(update_fields=['is_archived', 'archived_at', 'updated_at'])
        log(request, 'reactivate', v, f'Reactivated vehicle {v}')
        return Response(VehicleDetailSerializer(v, context={'request': request}).data)

    @action(detail=True, methods=['post', 'delete'], parser_classes=[MultiPartParser, FormParser],
            permission_classes=CAN_PHOTO)
    def photo(self, request, pk=None):
        """POST multipart `photo` to upload/replace; DELETE to remove. Needs fleet.manage_vehicle_photo."""
        v = self.get_object()
        old = v.photo.name if v.photo else None

        if request.method == 'DELETE':
            if not old:
                return Response(status=status.HTTP_204_NO_CONTENT)
            v.photo = None
            v.save(update_fields=['photo', 'updated_at'])
            log(request, 'photo_remove', v, f'Removed photo of {v}', {'photo': [old, None]})
        else:
            s = PhotoSerializer(data=request.data)
            s.is_valid(raise_exception=True)
            v.photo = s.validated_data['photo']
            v.save(update_fields=['photo', 'updated_at'])
            log(request, 'photo_replace' if old else 'photo_upload', v,
                f'{"Replaced" if old else "Uploaded"} photo of {v}', {'photo': [old, v.photo.name]})

        if old:
            # ponytail: obsolete photos are deleted immediately; switch to a retention job if policy requires keeping them.
            storage = v.photo.storage
            transaction.on_commit(lambda: storage.delete(old))
        data = VehicleDetailSerializer(v, context={'request': request}).data
        return Response(data, status=status.HTTP_200_OK)

    # ---- assignments (history is append-only: reassigning ends the old row and starts a new one) ----

    @action(detail=True, methods=['get', 'post'], permission_classes=CAN_VIEW_ASSIGNMENTS)
    def assignments(self, request, pk=None):
        """GET: assignment history, newest first. POST: assign or reassign the vehicle."""
        v = self.get_object()
        if request.method == 'GET':
            qs = v.assignments.select_related('vehicle', 'office').order_by('-start_date', '-id')
            page = self.paginate_queryset(qs)
            return self.get_paginated_response(AssignmentSerializer(page, many=True).data)

        if not request.user.has_perms(['fleet.add_vehicleassignment', 'fleet.change_vehicleassignment']):
            raise PermissionDenied('You are not allowed to assign vehicles.')
        s = AssignInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        new, ended = assignment_service.start_assignment(v, user=request.user, **s.validated_data)
        changes = {'driver': [ended.driver_name or None if ended else None, new.driver_name or None],
                   'accountable_person': [ended.accountable_person if ended else None, new.accountable_person],
                   'office': [ended.office.code if ended else None, new.office.code]}
        log(request, 'reassign' if ended else 'assign', v,
            f'{"Reassigned" if ended else "Assigned"} {v.plate_number} to {new.accountable_person} ({new.office.code})', changes)
        return Response(AssignmentSerializer(new).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='end-assignment', permission_classes=CAN_VIEW_ASSIGNMENTS)
    def end_assignment(self, request, pk=None):
        """End the current assignment, leaving the vehicle unassigned."""
        if not request.user.has_perm('fleet.change_vehicleassignment'):
            raise PermissionDenied('You are not allowed to end assignments.')
        v = self.get_object()
        s = EndAssignmentSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        ended = assignment_service.end_assignment(v, end_date=s.validated_data['end_date'])
        log(request, 'end_assignment', v, f'Ended assignment of {v.plate_number} ({ended.accountable_person})',
            {'end_date': [None, str(ended.end_date)]})
        return Response(AssignmentSerializer(ended).data)
