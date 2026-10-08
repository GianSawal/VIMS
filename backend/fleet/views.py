from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from accounts.permissions import OfficeScopedMixin, PasswordChangeNotRequired, require
from audit.services import diff, log

from .models import Vehicle
from .serializers import PhotoSerializer, VehicleDetailSerializer, VehicleSerializer

CAN_CHANGE = [require('fleet.change_vehicle'), PasswordChangeNotRequired]
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
        if self.action == 'list' and 'is_archived' not in p and not p.get('include_archived'):
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
