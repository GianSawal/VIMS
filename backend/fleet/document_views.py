from django.db.models import Count, F
from django_filters import rest_framework as filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from accounts.permissions import OfficeScopedMixin, PasswordChangeNotRequired, require
from audit.services import diff, log

from . import documents
from .document_serializers import CancelSerializer, DocumentSerializer, RenewSerializer
from .models import VehicleDocument

CAN_CHANGE = [require('fleet.change_vehicledocument'), PasswordChangeNotRequired]
AUDITED = ['reference_number', 'issue_date', 'expiry_date', 'file', 'status', 'remarks']


def snapshot(d):
    return {f: str(getattr(d, f) or '') for f in AUDITED}


def label(d):
    return f'{d.get_document_type_display()} of {d.vehicle.plate_number}'


class CharIn(filters.BaseInFilter, filters.CharFilter):
    pass


class DocumentFilter(filters.FilterSet):
    document_type = CharIn(help_text='One type or several, comma-separated (e.g. OR,CR)')
    office = filters.NumberFilter(field_name='vehicle__office')
    band = filters.CharFilter(method='by_band', help_text='EXPIRED, 7, 15, 30, 60, VALID or NONE (current documents)')
    expires_before = filters.DateFilter(field_name='expiry_date', lookup_expr='lte')

    class Meta:
        model = VehicleDocument
        fields = ['vehicle', 'status']

    def by_band(self, qs, name, value):
        if value not in documents.bands():
            return qs.none()
        return qs.filter(documents.band_filter(value), status=VehicleDocument.Status.ACTIVE)


class DocumentViewSet(OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                      mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    LTO registration, OR/CR, GSIS/insurance and other vehicle documents (multipart for the scanned `file`).
    Renewing creates a new current document and keeps the old one as history. No DELETE: cancel a wrong entry.
    """
    queryset = VehicleDocument.objects.select_related('vehicle', 'vehicle__office')
    serializer_class = DocumentSerializer
    office_field = 'vehicle__office'
    filterset_class = DocumentFilter
    search_fields = ['reference_number', 'vehicle__plate_number', 'remarks']
    ordering_fields = ['expiry_date', 'issue_date', 'created_at', 'vehicle__plate_number']

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == 'list' and 'ordering' not in self.request.query_params:
            qs = qs.order_by(F('expiry_date').asc(nulls_last=True), 'id')  # soonest to expire first
        return qs

    def _respond(self, doc, code=status.HTTP_200_OK):
        return Response(self.get_serializer(doc).data, status=code)

    def retrieve(self, request, *args, **kwargs):
        doc = self.get_object()
        data = self.get_serializer(doc).data
        history = VehicleDocument.objects.filter(vehicle=doc.vehicle, document_type=doc.document_type) \
            .select_related('vehicle', 'vehicle__office').order_by('-expiry_date', '-id')
        data['history'] = self.get_serializer(history, many=True).data  # every version, this one included
        return Response(data)

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        doc = documents.create(user=request.user, data=dict(s.validated_data))
        log(request, 'create', doc, f'Added {label(doc)}', {'after': snapshot(doc)})
        return self._respond(doc, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        doc = self.get_object()
        s = self.get_serializer(doc, data=request.data, partial=kwargs.get('partial', False))
        s.is_valid(raise_exception=True)
        data = dict(s.validated_data)
        for fixed in ('vehicle', 'document_type'):
            if fixed in data and data[fixed] == getattr(doc, fixed):
                data.pop(fixed)  # sent unchanged by a full PUT
        before = snapshot(doc)
        doc = documents.update(doc, data=data)
        changes = diff(before, snapshot(doc))
        if changes:
            log(request, 'update', doc, f'Updated {label(doc)}', changes)
        return self._respond(doc)

    @action(detail=True, methods=['post'], permission_classes=CAN_CHANGE)
    def renew(self, request, pk=None):
        """Record the renewed document (new reference, dates, scan). The current one moves to history."""
        if not request.user.has_perm('fleet.add_vehicledocument'):
            raise PermissionDenied('You do not have permission to perform this action.')
        old = self.get_object()
        s = RenewSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        new, old = documents.renew(old, user=request.user, data=dict(s.validated_data))
        log(request, 'document_renew', new, f'Renewed {label(new)}: expires {new.expiry_date or "never"} (was {old.expiry_date or "no expiry"})',
            {'previous_id': [None, old.pk], 'reference_number': [old.reference_number, new.reference_number],
             'expiry_date': [str(old.expiry_date), str(new.expiry_date)]})
        return self._respond(new, status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=CAN_CHANGE)
    def cancel(self, request, pk=None):
        """Cancel a wrongly entered current document (kept for the record, no longer alerts)."""
        s = CancelSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        doc = documents.cancel(self.get_object(), reason=s.validated_data['reason'])
        log(request, 'document_cancel', doc, f'Cancelled {label(doc)}: {s.validated_data["reason"]}', {'status': ['Active', 'Cancelled']})
        return self._respond(doc)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Current documents per expiry band for the same filters as the list (omit `band` for the cards)."""
        qs = self.filter_queryset(super().get_queryset()).filter(status=VehicleDocument.Status.ACTIVE).order_by()
        by_band = {b: qs.filter(documents.band_filter(b)).count() for b in documents.bands()}
        by_type = dict(qs.values_list('document_type').annotate(n=Count('id')))
        return Response({'total': sum(by_band.values()), 'by_band': by_band, 'by_type': by_type,
                         'thresholds': documents.thresholds()})
