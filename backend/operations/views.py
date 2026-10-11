from datetime import datetime, time, timedelta

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.permissions import OfficeScopedMixin, PasswordChangeNotRequired, require
from audit.services import diff, log
from fleet.attachments_api import AttachmentsMixin

from . import trips as trip_service
from .models import DisplayScreen, Trip
from .serializers import (DESCRIPTIVE, CancelSerializer, CompleteSerializer, DispatchScheduledSerializer,
                          DispatchSerializer, DisplayTripSerializer, RescheduleSerializer, ScheduleSerializer,
                          TripSerializer)

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


class DisplayTripsView(APIView):
    """
    Public trip board for a TV: GET /api/display/trips/?token=<screen token>. No staff login.
    Returns only display-safe fields for today (scheduled, out now, returned) and the next 7 days of bookings.
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

        today_trips = trips.filter(
            Q(scheduled_departure__gte=day_start, scheduled_departure__lt=day_end)
            | Q(departed_at__gte=day_start, departed_at__lt=day_end)
            | Q(status=Trip.Status.DISPATCHED)  # still out, whenever it left
            | Q(returned_at__gte=day_start, returned_at__lt=day_end)
        ).exclude(Q(status=Trip.Status.CANCELLED) & ~Q(scheduled_departure__gte=day_start, scheduled_departure__lt=day_end)
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
