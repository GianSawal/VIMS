from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import mixins, status, viewsets
from rest_framework import serializers as drf_serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.permissions import OfficeScopedMixin, PasswordChangeNotRequired, require
from audit.services import diff, log
from fleet.attachments_api import AttachmentsMixin

from . import fuel as fuel_service
from . import maps
from . import toll as toll_service
from . import trips as trip_service
from .models import DisplayScreen, FuelRecord, RFIDAccount, TollTransaction, Trip
from .serializers import (DESCRIPTIVE, CancelSerializer, CompleteSerializer, DispatchScheduledSerializer,
                          DispatchSerializer, DisplayScreenSerializer, DisplayTripSerializer, FuelRecordSerializer, RescheduleSerializer,
                          RFIDAccountSerializer, ScheduleSerializer, TollTransactionSerializer, TripSerializer)

CAN_CHANGE_TRIP = [require('operations.change_trip'), PasswordChangeNotRequired]
CAN_ADD_TRIP = [require('operations.add_trip'), PasswordChangeNotRequired]


class TripFilter(filters.FilterSet):
    office = filters.NumberFilter(field_name='vehicle__office')
    # Date range matches the actual departure, or the scheduled one for trips that haven't left.
    date_from = filters.DateFilter(method='on_or_after')
    date_to = filters.DateFilter(method='on_or_before')

    class Meta:
        model = Trip
        fields = ['status', 'vehicle', 'driver', 'requesting_office']

    def on_or_after(self, qs, name, value):
        return qs.alias(_from=Coalesce('departed_at', 'scheduled_departure')).filter(_from__date__gte=value)

    def on_or_before(self, qs, name, value):
        return qs.alias(_to=Coalesce('departed_at', 'scheduled_departure')).filter(_to__date__lte=value)


class TripViewSet(AttachmentsMixin, OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                  mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Trip tickets. POST dispatches (vehicle -> In Use); /complete/ records the return and moves the vehicle
    odometer forward; /cancel/ voids an open trip. PATCH edits descriptive fields only. No DELETE.
    """
    queryset = Trip.objects.select_related('vehicle', 'vehicle__office', 'driver', 'requesting_office')
    serializer_class = TripSerializer
    office_field = 'vehicle__office'
    filterset_class = TripFilter
    search_fields = ['ticket_number', 'vehicle__plate_number', 'driver__full_name', 'origin', 'destination', 'purpose']
    ordering_fields = ['departed_at', 'scheduled_departure', 'returned_at', 'distance_km', 'ticket_number']

    def create(self, request, *args, **kwargs):
        s = DispatchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        trip = trip_service.dispatch(user=request.user, **s.validated_data)
        log(request, 'trip_dispatch', trip,
            f'Dispatched {trip.vehicle.plate_number} with {trip.driver.full_name} to {trip.destination} ({trip.ticket_number})',
            {'odometer_start': [None, trip.odometer_start]})
        return Response(TripSerializer(trip).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        before = {f: str(getattr(serializer.instance, f'{f}_id' if f == 'requesting_office' else f)) for f in DESCRIPTIVE}
        trip = serializer.save()
        after = {f: str(getattr(trip, f'{f}_id' if f == 'requesting_office' else f)) for f in DESCRIPTIVE}
        changes = diff(before, after)
        if changes:
            log(self.request, 'update', trip, f'Updated trip {trip.ticket_number}', changes)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Counts per status and completed distance, for the same filters as the list (omit `status`)."""
        qs = self.filter_queryset(self.get_queryset()).order_by()
        agg = qs.aggregate(
            total=Count('id'),
            scheduled=Count('id', filter=Q(status=Trip.Status.SCHEDULED)),
            dispatched=Count('id', filter=Q(status=Trip.Status.DISPATCHED)),
            completed=Count('id', filter=Q(status=Trip.Status.COMPLETED)),
            cancelled=Count('id', filter=Q(status=Trip.Status.CANCELLED)),
            distance=Sum('distance_km', filter=Q(status=Trip.Status.COMPLETED)))
        return Response({'total': agg['total'], 'distance_km': agg['distance'] or 0, 'by_status': {
            'SCHEDULED': agg['scheduled'], 'DISPATCHED': agg['dispatched'], 'COMPLETED': agg['completed'], 'CANCELLED': agg['cancelled']}})

    # ---- scheduling -----------------------------------------------------------------------

    @action(detail=False, methods=['post'], permission_classes=CAN_ADD_TRIP)
    def schedule(self, request):
        """Book a trip ahead (status SCHEDULED). The odometer is entered when it is dispatched on the day."""
        s = ScheduleSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        trip = trip_service.schedule(user=request.user, **s.validated_data)
        when = timezone.localtime(trip.scheduled_departure).strftime('%b %d, %Y %I:%M %p')
        log(request, 'trip_schedule', trip,
            f'Scheduled {trip.vehicle.plate_number} with {trip.driver.full_name} to {trip.destination} on {when} ({trip.ticket_number})')
        return Response(TripSerializer(trip).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=CAN_CHANGE_TRIP)
    def reschedule(self, request, pk=None):
        s = RescheduleSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        trip, before = trip_service.reschedule(self.get_object(), user=request.user, **s.validated_data)
        after = {'vehicle': trip.vehicle.plate_number, 'driver': trip.driver.full_name,
                 'scheduled_departure': trip.scheduled_departure.isoformat(),
                 'scheduled_return': trip.scheduled_return.isoformat() if trip.scheduled_return else None}
        log(request, 'trip_reschedule', trip, f'Rescheduled trip {trip.ticket_number}', diff(before, after))
        return Response(TripSerializer(trip).data)

    @action(detail=True, methods=['post'], url_path='dispatch', permission_classes=CAN_CHANGE_TRIP)
    def dispatch_scheduled(self, request, pk=None):
        """The vehicle leaves on a scheduled trip: only on the scheduled day, with the odometer read now."""
        s = DispatchScheduledSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        trip = trip_service.dispatch_scheduled(self.get_object(), **s.validated_data)
        log(request, 'trip_dispatch', trip,
            f'Dispatched scheduled trip {trip.ticket_number}: {trip.vehicle.plate_number} with {trip.driver.full_name}',
            {'odometer_start': [None, trip.odometer_start]})
        return Response(TripSerializer(trip).data)

    @action(detail=True, methods=['post'], permission_classes=CAN_CHANGE_TRIP)
    def complete(self, request, pk=None):
        s = CompleteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        trip, previous = trip_service.complete(self.get_object(), **s.validated_data)
        log(request, 'trip_complete', trip,
            f'Completed trip {trip.ticket_number}: {trip.distance_km:,} km', {'odometer_end': [None, trip.odometer_end]})
        if trip.odometer_end != previous:
            log(request, 'odometer_update', trip.vehicle, f'Odometer updated by trip {trip.ticket_number}',
                {'current_odometer': [str(previous), str(trip.odometer_end)]})
        return Response(TripSerializer(trip).data)

    @action(detail=True, methods=['post'], permission_classes=CAN_CHANGE_TRIP)
    def cancel(self, request, pk=None):
        s = CancelSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        trip = trip_service.cancel(self.get_object(), reason=s.validated_data['reason'])
        log(request, 'trip_cancel', trip, f'Cancelled trip {trip.ticket_number}: {s.validated_data["reason"]}')
        return Response(TripSerializer(trip).data)


class DisplayScreenViewSet(OfficeScopedMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """TV screens and their links, for staff with operations.view_displayscreen. Manage them in Django admin."""
    queryset = DisplayScreen.objects.select_related('office').order_by('-is_active', 'name')
    serializer_class = DisplayScreenSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super(OfficeScopedMixin, self).get_queryset()
        user = self.request.user
        if user.has_perm('accounts.view_all_offices'):
            return qs
        return qs.filter(Q(office__in=user.offices.all()) | Q(office__isnull=True))  # all-office screens show for everyone


class DisplayTripsView(APIView):
    """
    Public trip board for a TV: GET /api/display/trips/?token=<screen token>. No staff login.
    Returns display-safe fields for trips out now, today's bookings not yet departed, trips returned today,
    and the next 7 days of bookings. Cancelled trips are never sent.
    """
    authentication_classes = []  # token in the URL, not a session: no CSRF, no user
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'display'
    UPCOMING_DAYS = 7

    def get(self, request):
        token = request.query_params.get('token', '')
        screen = DisplayScreen.objects.select_related('office').filter(token=token, is_active=True).first() if token else None
        if screen is None:
            raise PermissionDenied('This display link is invalid or has been turned off.')

        now = timezone.now()
        if not screen.last_seen_at or now - screen.last_seen_at > timedelta(minutes=1):
            DisplayScreen.objects.filter(pk=screen.pk).update(last_seen_at=now)

        today = timezone.localdate()
        day_start = timezone.make_aware(datetime.combine(today, time.min))
        day_end = day_start + timedelta(days=1)

        trips = Trip.objects.select_related('vehicle', 'vehicle__office', 'driver')
        if screen.office_id:
            trips = trips.filter(vehicle__office=screen.office_id)

        # On a trip now (whenever it left), today's bookings not yet gone, and trips that returned today
        # (shown as a subordinate "Completed today" strip). Cancelled trips are never sent.
        today_trips = trips.filter(
            Q(status=Trip.Status.DISPATCHED)
            | Q(status=Trip.Status.SCHEDULED, scheduled_departure__gte=day_start, scheduled_departure__lt=day_end)
            | Q(status=Trip.Status.COMPLETED, returned_at__gte=day_start, returned_at__lt=day_end)
        ).order_by(Coalesce('departed_at', 'scheduled_departure'))
        upcoming = trips.filter(status=Trip.Status.SCHEDULED, scheduled_departure__gte=day_end,
                                scheduled_departure__lt=day_end + timedelta(days=self.UPCOMING_DAYS)
                                ).order_by('scheduled_departure')

        return Response({
            'screen': screen.name,
            'office': {'code': screen.office.code, 'name': screen.office.name} if screen.office else None,
            'generated_at': now,
            'today': DisplayTripSerializer(today_trips, many=True).data,
            'upcoming': DisplayTripSerializer(upcoming, many=True).data,
        })


# ---------------------------------------------------------------- fuel

class FuelFilter(filters.FilterSet):
    office = filters.NumberFilter(field_name='vehicle__office')
    date_from = filters.DateFilter(field_name='date', lookup_expr='gte')
    date_to = filters.DateFilter(field_name='date', lookup_expr='lte')
    has_po = filters.BooleanFilter(method='with_po', help_text='true = Fuel PO log (records with a PO number)')

    class Meta:
        model = FuelRecord
        fields = ['vehicle', 'driver', 'fuel_type', 'is_full_tank']

    def with_po(self, qs, name, value):
        return qs.exclude(po_number='') if value else qs.filter(po_number='')


FUEL_AUDITED = ['date', 'vehicle', 'driver', 'po_number', 'supplier', 'fuel_type', 'liters', 'unit_price',
                'total_amount', 'odometer', 'is_full_tank', 'receipt_number']


def fuel_snapshot(r):
    return {f: str(getattr(r, f'{f}_id' if f in ('vehicle', 'driver') else f)) for f in FUEL_AUDITED}


class FuelRecordViewSet(AttachmentsMixin, OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                        mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Fuel fill-ups. The same rows feed the Fuel PO log (`?has_po=true`), so PO data is never entered twice.
    Distance since last fill-up and estimated km/L (full tank to full tank) are computed, never typed. No DELETE.
    """
    queryset = FuelRecord.objects.select_related('vehicle', 'vehicle__office', 'driver')
    serializer_class = FuelRecordSerializer
    office_field = 'vehicle__office'
    filterset_class = FuelFilter
    search_fields = ['po_number', 'receipt_number', 'supplier', 'vehicle__plate_number', 'driver__full_name']
    ordering_fields = ['date', 'odometer', 'liters', 'total_amount', 'unit_price']

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action in ('list', 'retrieve'):
            qs = fuel_service.with_analytics(qs).annotate(attachment_count=Count('attachments', distinct=True))
            qs = qs.order_by('-date', '-odometer', '-id')  # GROUP BY from Count drops Meta.ordering
        return qs

    def _respond(self, record, code):
        record = self.get_queryset().model.objects.filter(pk=record.pk)
        record = fuel_service.with_analytics(record.select_related('vehicle', 'vehicle__office', 'driver')).get()
        return Response(FuelRecordSerializer(record, context=self.get_serializer_context()).data, status=code)

    def _log_odometer(self, record, before, after):
        if after != before:
            log(self.request, 'odometer_update', record.vehicle, f'Odometer updated by fuel record on {record.date}',
                {'current_odometer': [str(before), str(after)]})

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        record, before, after = fuel_service.save_record(user=request.user, data=dict(s.validated_data))
        log(request, 'create', record, f'Fuel: {record.liters} L for {record.vehicle.plate_number} on {record.date}',
            {'after': fuel_snapshot(record)})
        self._log_odometer(record, before, after)
        return self._respond(record, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        s = self.get_serializer(instance, data=request.data, partial=kwargs.get('partial', False))
        s.is_valid(raise_exception=True)
        before_snap = fuel_snapshot(instance)
        data = {f: getattr(instance, f) for f in FUEL_AUDITED + ['remarks']}
        data.update(s.validated_data)
        if 'total_amount' not in s.validated_data and ({'liters', 'unit_price'} & set(s.validated_data)):
            data['total_amount'] = None  # recompute when quantity/price change without a new receipt total
        record, before, after = fuel_service.save_record(user=request.user, instance=instance, data=data)
        changes = diff(before_snap, fuel_snapshot(record))
        if changes:
            log(request, 'update', record, f'Updated fuel record of {record.vehicle.plate_number} on {record.date}', changes)
        self._log_odometer(record, before, after)
        return self._respond(record, status.HTTP_200_OK)

    @action(detail=False, methods=['get'])
    def insights(self, request):
        """
        Chart data for the same filters as the list: cost/liters per month (last 12 months unless a date range
        is given; empty months are zero) and the top 5 vehicles by fuel cost.
        """
        qs = self.filter_queryset(super().get_queryset()).order_by()
        today = timezone.localdate()
        p = request.query_params
        if p.get('date_from') or p.get('date_to'):
            first = qs.order_by('date').values_list('date', flat=True).first()
            last = qs.order_by('-date').values_list('date', flat=True).first()
            start, end = (first or today).replace(day=1), (last or today).replace(day=1)
        else:
            end = today.replace(day=1)
            start = (end - timedelta(days=330)).replace(day=1)
            qs = qs.filter(date__gte=start)
        by_month = {r['month'].strftime('%Y-%m'): r for r in qs.annotate(month=TruncMonth('date'))
                    .values('month').annotate(amount=Sum('total_amount'), liters=Sum('liters')).order_by('month')}
        money = lambda v: str(Decimal(str(v or 0)).quantize(Decimal('0.01')))   # same shape on MySQL and SQLite
        qty = lambda v: str(Decimal(str(v or 0)).quantize(Decimal('0.001')))
        months, cur = [], start
        while cur <= end and len(months) < 36:
            key = cur.strftime('%Y-%m')
            r = by_month.get(key, {})
            months.append({'month': key, 'amount': money(r.get('amount')), 'liters': qty(r.get('liters'))})
            cur = (cur + timedelta(days=32)).replace(day=1)
        top = (qs.values('vehicle_id', 'vehicle__plate_number', 'vehicle__make', 'vehicle__model')
               .annotate(amount=Sum('total_amount'), liters=Sum('liters'), fills=Count('id')).order_by('-amount')[:5])
        return Response({'months': months, 'top_vehicles': [
            {'vehicle': t['vehicle_id'], 'plate_number': t['vehicle__plate_number'],
             'label': f"{t['vehicle__make']} {t['vehicle__model']}", 'amount': money(t['amount']),
             'liters': qty(t['liters']), 'fills': t['fills']} for t in top]})

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Totals for the same filters as the list."""
        qs = self.filter_queryset(super().get_queryset()).order_by()
        agg = qs.aggregate(count=Count('id'), liters=Sum('liters'), amount=Sum('total_amount'),
                           full=Count('id', filter=Q(is_full_tank=True)), with_po=Count('id', filter=~Q(po_number='')))
        dec = lambda v, places: str(Decimal(str(v or 0)).quantize(Decimal(places)))  # strings, like DecimalFields
        liters, amount = Decimal(str(agg['liters'] or 0)), Decimal(str(agg['amount'] or 0))
        return Response({'count': agg['count'], 'liters': dec(liters, '0.001'), 'amount': dec(amount, '0.01'),
                         'average_price': dec(amount / liters, '0.01') if liters else None,
                         'full_tank_count': agg['full'], 'with_po_count': agg['with_po']})


# ---------------------------------------------------------------- Maps: Geoapify (server-side proxy)

class MapsRouteInput(drf_serializers.Serializer):
    class Point(drf_serializers.Serializer):
        lat = drf_serializers.FloatField(required=False, min_value=-90, max_value=90)
        lon = drf_serializers.FloatField(required=False, min_value=-180, max_value=180)
        address = drf_serializers.CharField(required=False, allow_blank=True, max_length=300)

        def validate(self, attrs):
            has_coords = attrs.get('lat') is not None and attrs.get('lon') is not None
            if not has_coords and not attrs.get('address', '').strip():
                raise drf_serializers.ValidationError('Pick a place or type an address.')
            return attrs

    origin = Point()
    destination = Point()


class MapsView(APIView):
    """Place search and driving route for trip forms (Geoapify). Needs operations.add_trip; the key never leaves the server."""
    permission_classes = [require('operations.add_trip'), PasswordChangeNotRequired]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'maps'

    def get(self, request, op):
        if op == 'status':
            return Response({'enabled': maps.enabled(), 'provider': maps.provider(), 'providers': maps.providers()})
        if op != 'autocomplete':
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not maps.enabled():
            return Response({'detail': 'The trip map is not set up.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        q = request.query_params.get('q', '').strip()
        if len(q) < 3:
            return Response({'results': []})
        try:
            return Response({'results': maps.autocomplete(q[:200])})
        except maps.MapsError as e:
            return Response({'detail': str(e)}, status=status.HTTP_502_BAD_GATEWAY)

    def post(self, request, op):
        if op != 'route':
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not maps.enabled():
            return Response({'detail': 'The trip map is not set up.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        s = MapsRouteInput(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            return Response(maps.route(s.validated_data['origin'], s.validated_data['destination']))
        except maps.MapsError as e:
            return Response({'detail': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


# ---------------------------------------------------------------- RFID / toll (Phase 10)

def _money(v):
    return str(Decimal(str(v or 0)).quantize(Decimal('0.01')))  # same shape on MySQL and SQLite


RFID_AUDITED = ['provider', 'account_number', 'vehicle', 'is_active', 'balance', 'remarks']
TOLL_AUDITED = ['account', 'vehicle', 'trip', 'transacted_at', 'description', 'credit', 'debit', 'reference_number']


def rfid_snapshot(a):
    snap = {f: str(getattr(a, f'{f}_id' if f == 'vehicle' else f) or '') for f in RFID_AUDITED}
    snap['account_number'] = toll_service.mask_account(a.account_number)  # never log the full number
    return snap


def toll_snapshot(x):
    return {f: str(getattr(x, f'{f}_id' if f in ('account', 'vehicle', 'trip') else f) or '') for f in TOLL_AUDITED}


class RFIDAccountFilter(filters.FilterSet):
    office = filters.NumberFilter(field_name='vehicle__office')
    unassigned = filters.BooleanFilter(field_name='vehicle', lookup_expr='isnull')

    class Meta:
        model = RFIDAccount
        fields = ['provider', 'is_active', 'vehicle']


class RFIDAccountViewSet(OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                         mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    RFID / toll accounts (Easytrip, Autosweep). The account number is masked for view-only users and no
    third-party password is stored. Assign to a vehicle or leave unassigned. No DELETE: deactivate instead.
    """
    queryset = RFIDAccount.objects.select_related('vehicle', 'vehicle__office')
    serializer_class = RFIDAccountSerializer
    office_field = 'vehicle__office'
    filterset_class = RFIDAccountFilter
    search_fields = ['account_number', 'remarks', 'vehicle__plate_number']
    ordering_fields = ['provider', 'is_active', 'balance']

    def get_queryset(self):
        qs = self.queryset  # unassigned accounts belong to no office; show them to everyone who may view
        user = self.request.user
        if not user.has_perm('accounts.view_all_offices'):
            qs = qs.filter(Q(vehicle__office__in=user.offices.all()) | Q(vehicle__isnull=True))
        if self.action in ('list', 'retrieve'):
            qs = qs.annotate(transaction_count=Count('transactions', distinct=True)).order_by('-is_active', 'provider', 'account_number')
        return qs

    def _respond(self, account, code=status.HTTP_200_OK):
        fresh = self.queryset.filter(pk=account.pk).annotate(transaction_count=Count('transactions', distinct=True)).get()
        return Response(self.get_serializer(fresh).data, status=code)

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        account = toll_service.save_account(user=request.user, data=dict(s.validated_data))
        log(request, 'create', account, f'Added RFID account {account.get_provider_display()} {toll_service.mask_account(account.account_number)}',
            {'after': rfid_snapshot(account)})
        return self._respond(account, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        s = self.get_serializer(instance, data=request.data, partial=kwargs.get('partial', False))
        s.is_valid(raise_exception=True)
        before = rfid_snapshot(instance)
        account = toll_service.save_account(user=request.user, instance=instance, data=dict(s.validated_data))
        changes = diff(before, rfid_snapshot(account))
        if changes:
            log(request, 'update', account, f'Updated RFID account {account.get_provider_display()} {toll_service.mask_account(account.account_number)}', changes)
        return self._respond(account)

    @action(detail=True, methods=['get'])
    def transactions(self, request, pk=None):
        """This account's toll transactions, newest first, each with the running balance (credit - debit)."""
        account = self.get_object()
        txns = list(account.transactions.select_related('vehicle', 'trip'))
        rows = toll_service.with_running_balance(txns)
        data = TollTransactionSerializer(rows, many=True, context=self.get_serializer_context()).data
        credit = sum((x.credit for x in txns), Decimal('0'))
        debit = sum((x.debit for x in txns), Decimal('0'))
        return Response({'results': data, 'credit': _money(credit), 'debit': _money(debit), 'net': _money(credit - debit)})


class TollFilter(filters.FilterSet):
    office = filters.NumberFilter(field_name='vehicle__office')
    provider = filters.CharFilter(field_name='account__provider')
    date_from = filters.DateTimeFilter(field_name='transacted_at', lookup_expr='gte')
    date_to = filters.DateTimeFilter(field_name='transacted_at', lookup_expr='lte')
    kind = filters.ChoiceFilter(method='by_kind', choices=[('credit', 'Load'), ('debit', 'Charge')])

    class Meta:
        model = TollTransaction
        fields = ['account', 'vehicle', 'trip']

    def by_kind(self, qs, name, value):
        return qs.filter(credit__gt=0) if value == 'credit' else qs.filter(debit__gt=0)


class TollTransactionViewSet(OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                             mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Toll / RFID transactions: a load (credit) or a charge (debit), optionally linked to a trip. No DELETE."""
    queryset = TollTransaction.objects.select_related('account', 'vehicle', 'vehicle__office', 'trip')
    serializer_class = TollTransactionSerializer
    office_field = 'vehicle__office'
    filterset_class = TollFilter
    search_fields = ['description', 'reference_number', 'vehicle__plate_number', 'account__account_number']
    ordering_fields = ['transacted_at', 'credit', 'debit']

    def _respond(self, x, code=status.HTTP_200_OK):
        return Response(self.get_serializer(self.queryset.get(pk=x.pk)).data, status=code)

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        x = toll_service.save_transaction(user=request.user, data=dict(s.validated_data))
        log(request, 'create', x, f'Toll {"load" if x.credit else "charge"} for {x.vehicle.plate_number}: {x.description[:80]}',
            {'after': toll_snapshot(x)})
        return self._respond(x, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        s = self.get_serializer(instance, data=request.data, partial=kwargs.get('partial', False))
        s.is_valid(raise_exception=True)
        before = toll_snapshot(instance)
        x = toll_service.save_transaction(user=request.user, instance=instance, data=dict(s.validated_data))
        changes = diff(before, toll_snapshot(x))
        if changes:
            log(request, 'update', x, f'Updated toll transaction for {x.vehicle.plate_number}', changes)
        return self._respond(x)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Loads, charges and their net for the same filters as the list (omit `kind` for the totals)."""
        agg = self.filter_queryset(self.get_queryset()).order_by().aggregate(credit=Sum('credit'), debit=Sum('debit'), n=Count('id'))
        credit, debit = Decimal(str(agg['credit'] or 0)), Decimal(str(agg['debit'] or 0))
        return Response({'total': agg['n'], 'credit': _money(credit), 'debit': _money(debit), 'net': _money(credit - debit)})
