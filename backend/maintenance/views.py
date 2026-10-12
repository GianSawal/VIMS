from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import OfficeScopedMixin, PasswordChangeNotRequired, require
from audit.services import diff, log
from fleet.attachments_api import AttachmentsMixin

from . import service
from .models import MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule
from .serializers import (CategorySerializer, RecordSerializer, ScheduleSerializer, StatusChangeSerializer)

CAN_CHANGE = [require('maintenance.change_maintenancerecord'), PasswordChangeNotRequired]
AUDITED = ['vehicle', 'date', 'odometer', 'reference_number', 'description', 'service_provider', 'labor_cost',
           'parts_cost', 'next_service_date', 'next_service_odometer', 'remarks']


def snapshot(r):
    snap = {f: str(getattr(r, f'{f}_id' if f == 'vehicle' else f)) for f in AUDITED}
    snap['categories'] = ', '.join(sorted(c.name for c in r.categories.all()))
    return snap


money = lambda v: str(Decimal(str(v or 0)).quantize(Decimal('0.01')))  # same output on MySQL and SQLite


class CategoryViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                      mixins.UpdateModelMixin, OfficeScopedMixin, viewsets.GenericViewSet):
    """Reference list. No DELETE: deactivate a category instead."""
    queryset = MaintenanceCategory.objects.all()
    serializer_class = CategorySerializer
    office_field = None  # not office-specific
    pagination_class = None

    def perform_create(self, serializer):
        c = serializer.save()
        log(self.request, 'create', c, f'Created maintenance category {c.name}')

    def perform_update(self, serializer):
        before = CategorySerializer(serializer.instance).data
        c = serializer.save()
        log(self.request, 'update', c, f'Updated maintenance category {c.name}', diff(before, CategorySerializer(c).data))


class RecordFilter(filters.FilterSet):
    office = filters.NumberFilter(field_name='vehicle__office')
    category = filters.NumberFilter(field_name='categories')
    date_from = filters.DateFilter(field_name='date', lookup_expr='gte')
    date_to = filters.DateFilter(field_name='date', lookup_expr='lte')
    open = filters.BooleanFilter(method='only_open', help_text='true = not yet completed or cancelled')

    class Meta:
        model = MaintenanceRecord
        fields = ['vehicle', 'status', 'service_provider']

    def only_open(self, qs, name, value):
        return qs.filter(status__in=service.OPEN) if value else qs.exclude(status__in=service.OPEN)


class MaintenanceRecordViewSet(AttachmentsMixin, OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                               mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Maintenance events. A vehicle can have several categories per event. Status moves only through
    POST /maintenance/{id}/status/ (completion updates the preventive-maintenance schedules). No DELETE.
    """
    queryset = MaintenanceRecord.objects.select_related('vehicle', 'vehicle__office').prefetch_related('categories')
    serializer_class = RecordSerializer
    office_field = 'vehicle__office'
    filterset_class = RecordFilter
    search_fields = ['reference_number', 'description', 'service_provider', 'vehicle__plate_number']
    ordering_fields = ['date', 'completed_on', 'status', 'next_service_date']

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action in ('list', 'retrieve'):
            qs = qs.annotate(attachment_count=Count('attachments', distinct=True)).order_by('-date', '-id')
        return qs

    def _respond(self, record, code=status.HTTP_200_OK):
        fresh = self.get_queryset().model.objects.filter(pk=record.pk).select_related('vehicle', 'vehicle__office') \
            .prefetch_related('categories').annotate(attachment_count=Count('attachments', distinct=True)).get()
        return Response(RecordSerializer(fresh, context=self.get_serializer_context()).data, status=code)

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = dict(s.validated_data)
        record = service.save_record(user=request.user, data=data, categories=data.pop('categories'))
        log(request, 'create', record, f'Maintenance for {record.vehicle.plate_number}: {record.description[:80]}',
            {'after': snapshot(record)})
        return self._respond(record, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        s = self.get_serializer(instance, data=request.data, partial=kwargs.get('partial', False))
        s.is_valid(raise_exception=True)
        data = dict(s.validated_data)
        categories = data.pop('categories', None)
        before = snapshot(instance)
        record = service.save_record(user=request.user, instance=instance, data=data, categories=categories)
        changes = diff(before, snapshot(record))
        if changes:
            log(request, 'update', record, f'Updated maintenance of {record.vehicle.plate_number}', changes)
        return self._respond(record)

    @action(detail=True, methods=['post'], permission_classes=CAN_CHANGE)
    def status(self, request, pk=None):
        """Move the record forward (inspection, in progress, completed) or cancel it."""
        s = StatusChangeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        record = self.get_object()
        old = record.get_status_display()
        record, notes = service.change_status(record, user=request.user, **s.validated_data)
        log(request, f'maintenance_{record.status.lower()}', record,
            f'{record.vehicle.plate_number}: {old} -> {record.get_status_display()}' + (f' ({"; ".join(notes)})' if notes else ''),
            {'status': [old, record.get_status_display()], **({'total_cost': [None, str(record.total_cost)]} if record.status == 'COMPLETED' else {})})
        return self._respond(record)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Counts per status and total cost for the same filters as the list (omit `status` for status cards)."""
        qs = self.filter_queryset(super().get_queryset()).order_by()
        rows = {r['status']: r for r in qs.values('status').annotate(n=Count('id'), cost=Sum('labor_cost') + Sum('parts_cost'))}
        by_status = {k: rows.get(k, {}).get('n', 0) for k, _ in MaintenanceRecord.Status.choices}
        done = qs.filter(status=MaintenanceRecord.Status.COMPLETED).aggregate(labor=Sum('labor_cost'), parts=Sum('parts_cost'))
        labor, parts = Decimal(str(done['labor'] or 0)), Decimal(str(done['parts'] or 0))
        return Response({'total': sum(by_status.values()), 'by_status': by_status, 'labor': money(labor), 'parts': money(parts),
                         'cost': money(labor + parts)})

    @action(detail=False, methods=['get'])
    def insights(self, request):
        """Completed-maintenance cost per month (last 12 months, or the date range) and per category."""
        qs = self.filter_queryset(super().get_queryset()).order_by().filter(status=MaintenanceRecord.Status.COMPLETED)
        today = timezone.localdate()
        p = request.query_params
        if p.get('date_from') or p.get('date_to'):
            first, last = qs.order_by('date').values_list('date', flat=True).first(), qs.order_by('-date').values_list('date', flat=True).first()
            start, end = (first or today).replace(day=1), (last or today).replace(day=1)
        else:
            end = today.replace(day=1)
            start = (end - timedelta(days=330)).replace(day=1)
            qs = qs.filter(date__gte=start)
        by_month = {r['m'].strftime('%Y-%m'): r for r in qs.annotate(m=TruncMonth('date')).values('m')
                    .annotate(labor=Sum('labor_cost'), parts=Sum('parts_cost'), n=Count('id'))}
        months, cur = [], start
        while cur <= end and len(months) < 36:
            r = by_month.get(cur.strftime('%Y-%m'), {})
            months.append({'month': cur.strftime('%Y-%m'), 'amount': money(Decimal(str(r.get('labor') or 0)) + Decimal(str(r.get('parts') or 0))),
                           'count': r.get('n', 0)})
            cur = (cur + timedelta(days=32)).replace(day=1)
        cats = (qs.values('categories__id', 'categories__name').annotate(n=Count('id', distinct=True),
                cost=Sum('labor_cost') + Sum('parts_cost')).order_by('-cost')[:5])
        return Response({'months': months, 'top_categories': [
            {'category': c['categories__id'], 'name': c['categories__name'], 'count': c['n'], 'amount': money(c['cost'])} for c in cats]})


class ScheduleFilter(filters.FilterSet):
    office = filters.NumberFilter(field_name='vehicle__office')
    due = filters.ChoiceFilter(choices=[(k, k) for k in ('OVERDUE', 'DUE_SOON', 'OK', 'NO_BASELINE')], method='by_due')

    class Meta:
        model = MaintenanceSchedule
        fields = ['vehicle', 'category', 'is_active']

    def by_due(self, qs, name, value):
        # ponytail: evaluated in Python (a fleet has dozens of schedules, not millions). Move to SQL if that changes.
        ids = [s.pk for s in qs.select_related('vehicle') if service.schedule_state(s)['status'] == value]
        return qs.filter(pk__in=ids)


class ScheduleViewSet(OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                      mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Preventive-maintenance rules per vehicle and category, with due / overdue calculated live. No DELETE: deactivate."""
    queryset = MaintenanceSchedule.objects.select_related('vehicle', 'vehicle__office', 'category')
    serializer_class = ScheduleSerializer
    office_field = 'vehicle__office'
    filterset_class = ScheduleFilter
    search_fields = ['vehicle__plate_number', 'category__name']
    ordering_fields = ['vehicle__plate_number', 'category__name']

    def perform_create(self, serializer):
        s = super().perform_create(serializer)
        log(self.request, 'create', s, f'Created schedule {s}', {'after': {'interval_days': s.interval_days, 'interval_km': s.interval_km}})

    def perform_update(self, serializer):
        before = ScheduleSerializer(serializer.instance, context=self.get_serializer_context()).data
        s = super().perform_update(serializer)
        keep = ('interval_days', 'interval_km', 'last_service_date', 'last_service_odometer', 'is_active')
        changes = diff({k: before[k] for k in keep}, {k: getattr(s, k) for k in keep})
        if changes:
            log(self.request, 'update', s, f'Updated schedule {s}', {k: [str(a), str(b)] for k, (a, b) in changes.items()})

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """How many active schedules are overdue / due soon / ok for the same filters (omit `due` for cards)."""
        qs = self.filter_queryset(self.get_queryset()).filter(is_active=True)
        counts = {'OVERDUE': 0, 'DUE_SOON': 0, 'OK': 0, 'NO_BASELINE': 0}
        for s in qs:
            counts[service.schedule_state(s)['status']] += 1
        return Response({'total': sum(counts.values()), 'by_due': counts})
