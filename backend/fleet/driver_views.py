from datetime import timedelta

from django.db.models import Count, Prefetch, Q
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import OfficeScopedMixin, PasswordChangeNotRequired, require
from audit.services import diff, log

from .attachments_api import AttachmentsMixin
from .driver_serializers import AssignmentSerializer, DriverSerializer
from .models import Driver, VehicleAssignment

AUDITED = ['employee_number', 'full_name', 'office', 'contact_number', 'license_number', 'license_type',
           'license_restrictions', 'license_issue_date', 'license_expiry_date', 'is_active']


def snapshot(d):
    return {f: str(getattr(d, f'{f}_id' if f == 'office' else f)) for f in AUDITED}


class DriverFilter(filters.FilterSet):
    license_status = filters.ChoiceFilter(
        choices=[('VALID', 'Valid'), ('EXPIRING', 'Expiring soon'), ('EXPIRED', 'Expired')], method='by_license')

    class Meta:
        model = Driver
        fields = ['office', 'is_active']

    def by_license(self, qs, name, value):
        today = timezone.localdate()
        soon = today + timedelta(days=Driver.EXPIRING_DAYS)
        if value == 'EXPIRED':
            return qs.filter(license_expiry_date__lt=today)
        if value == 'EXPIRING':
            return qs.filter(license_expiry_date__gte=today, license_expiry_date__lte=soon)
        return qs.filter(license_expiry_date__gt=soon)


class DriverViewSet(AttachmentsMixin, OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                    mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Driver profiles. No DELETE: deactivate (is_active=false) so trips and assignments keep their history."""
    queryset = Driver.objects.select_related('office').prefetch_related(
        Prefetch('assignments', queryset=VehicleAssignment.objects.select_related('vehicle')))
    serializer_class = DriverSerializer
    filterset_class = DriverFilter
    search_fields = ['full_name', 'employee_number', 'license_number']
    ordering_fields = ['full_name', 'license_expiry_date', 'updated_at']

    def perform_create(self, serializer):
        d = super().perform_create(serializer)
        log(self.request, 'create', d, f'Created driver {d.full_name}', {'after': snapshot(d)})

    def perform_update(self, serializer):
        before = snapshot(serializer.instance)
        d = super().perform_update(serializer)
        changes = diff(before, snapshot(d))
        if changes:
            log(self.request, 'update', d, f'Updated driver {d.full_name}', changes)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """License-status counts for the same filters as the list (omit `license_status` to power status cards)."""
        today = timezone.localdate()
        soon = today + timedelta(days=Driver.EXPIRING_DAYS)
        agg = self.filter_queryset(self.get_queryset()).order_by().aggregate(
            total=Count('id'),
            expired=Count('id', filter=Q(license_expiry_date__lt=today)),
            expiring=Count('id', filter=Q(license_expiry_date__gte=today, license_expiry_date__lte=soon)))
        return Response({'total': agg['total'], 'by_license': {
            'VALID': agg['total'] - agg['expired'] - agg['expiring'],
            'EXPIRING': agg['expiring'], 'EXPIRED': agg['expired']}})

    @action(detail=True, methods=['get'], permission_classes=[require('fleet.view_vehicleassignment'), PasswordChangeNotRequired])
    def assignments(self, request, pk=None):
        """Every vehicle this driver has been assigned to, newest first."""
        qs = self.get_object().assignments.select_related('vehicle', 'office').order_by('-start_date', '-id')
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(AssignmentSerializer(page, many=True).data)
