from django.db.models import Count, Q, Sum
from django_filters import rest_framework as filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import OfficeScopedMixin, PasswordChangeNotRequired, require
from audit.services import diff, log
from fleet.attachments_api import AttachmentsMixin

from . import trips as trip_service
from .models import Trip
from .serializers import DESCRIPTIVE, CancelSerializer, CompleteSerializer, DispatchSerializer, TripSerializer

CAN_CHANGE_TRIP = [require('operations.change_trip'), PasswordChangeNotRequired]


class TripFilter(filters.FilterSet):
    office = filters.NumberFilter(field_name='vehicle__office')
    date_from = filters.DateFilter(field_name='departed_at', lookup_expr='date__gte')
    date_to = filters.DateFilter(field_name='departed_at', lookup_expr='date__lte')

    class Meta:
        model = Trip
        fields = ['status', 'vehicle', 'driver', 'requesting_office']


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
    ordering_fields = ['departed_at', 'returned_at', 'distance_km', 'ticket_number']

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
            dispatched=Count('id', filter=Q(status=Trip.Status.DISPATCHED)),
            completed=Count('id', filter=Q(status=Trip.Status.COMPLETED)),
            cancelled=Count('id', filter=Q(status=Trip.Status.CANCELLED)),
            distance=Sum('distance_km', filter=Q(status=Trip.Status.COMPLETED)))
        return Response({'total': agg['total'], 'distance_km': agg['distance'] or 0, 'by_status': {
            'DISPATCHED': agg['dispatched'], 'COMPLETED': agg['completed'], 'CANCELLED': agg['cancelled']}})

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
