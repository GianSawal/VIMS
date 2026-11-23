from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from accounts.permissions import OfficeScopedMixin, PasswordChangeNotRequired, require
from accounts.views import user_snapshot
from audit.services import diff, log
from config.removal import RemoveMixin

from . import driver_accounts
from .attachments_api import AttachmentsMixin
from .driver_serializers import AssignmentSerializer, DriverSerializer
from .models import Driver, VehicleAssignment
from .photos import change_photo

CAN_MAKE_ACCOUNTS = [require('accounts.add_user', 'fleet.view_driver'), PasswordChangeNotRequired]

NO_STORE = {'Cache-Control': 'no-store'}  # responses carrying temporary passwords

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


class DriverViewSet(RemoveMixin, AttachmentsMixin, OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                    mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Driver profiles. No DELETE: deactivate (is_active=false) so trips and assignments keep their history."""
    queryset = Driver.objects.select_related('office', 'user').prefetch_related(
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
        # The driver's login follows the record: a deactivated driver can no longer sign in.
        if 'is_active' in changes and d.user and d.user.is_active != d.is_active:
            d.user.is_active = d.is_active
            d.user.save(update_fields=['is_active'])
            log(self.request, 'update', d.user, f'{"Enabled" if d.is_active else "Disabled"} login {d.user.username} with driver {d.full_name}',
                {'is_active': [not d.is_active, d.is_active]})

    @action(detail=True, methods=['post', 'delete'], parser_classes=[MultiPartParser, FormParser],
            permission_classes=[require('fleet.change_driver'), PasswordChangeNotRequired])
    def photo(self, request, pk=None):
        """POST multipart `photo` (JPEG/PNG/WebP) to upload/replace; DELETE to remove."""
        d = self.get_object()
        change_photo(request, d)
        return Response(self.get_serializer(self.get_queryset().get(pk=d.pk)).data)

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

    def _account_created(self, request, d, user, password):
        log(request, 'create', user, f'Created login {user.username} for driver {d.full_name}',
            {'after': user_snapshot(user)})  # never the password
        return {'driver': d.pk, 'full_name': d.full_name, 'office_code': d.office.code,
                'username': user.username, 'password': password}

    @action(detail=True, methods=['post'], permission_classes=CAN_MAKE_ACCOUNTS)
    def account(self, request, pk=None):
        """Create this driver's login (role Driver). The temporary password is in the response only, once."""
        d = self.get_object()
        user, password = driver_accounts.create_account(d)
        return Response(self._account_created(request, d, user, password), status=status.HTTP_201_CREATED, headers=NO_STORE)

    @action(detail=False, methods=['post'], url_path='create-accounts', permission_classes=CAN_MAKE_ACCOUNTS)
    def create_accounts(self, request):
        """A login for every active driver (in your offices) that has none yet. Returns each username and
        temporary password, once."""
        made = []
        with transaction.atomic():  # all or none: a failure halfway must not create logins whose passwords nobody saw
            for d in self.get_queryset().filter(is_active=True, user__isnull=True):
                user, password = driver_accounts.create_account(d)
                made.append(self._account_created(request, d, user, password))
        return Response({'created': made}, status=status.HTTP_201_CREATED if made else status.HTTP_200_OK,
                        headers=NO_STORE)
