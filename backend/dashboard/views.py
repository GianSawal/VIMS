"""
Phase 12 dashboard: one read-only endpoint, GET /api/dashboard/?office=<id>&month=YYYY-MM.

Every section is office-scoped (scope_to_offices, same as the lists) and only sent when the user may view
that module, so a section is never a way around model permissions. Each figure uses the same rules as the
list page its card links to (vehicle/document/schedule/driver summaries), so the numbers match on click-through.
`month` (default: this month) drives the fuel, maintenance-cost and utilization figures.
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Office
from accounts.permissions import scope_to_offices
from fleet import documents
from fleet.models import Driver, Vehicle, VehicleDocument
from maintenance import service as maintenance_service
from maintenance.models import MaintenanceRecord, MaintenanceSchedule
from operations.models import FuelRecord, Trip

TREND_MONTHS = 6
ITEMS = 5           # rows in each "what needs attention" widget
ACTIVITY = 10       # rows in Recent activity

money = lambda v: str(Decimal(str(v or 0)).quantize(Decimal('0.01')))  # same output on MySQL and SQLite
qty = lambda v: str(Decimal(str(v or 0)).quantize(Decimal('0.001')))
LTO_TYPES = [VehicleDocument.Type.LTO_REGISTRATION]
INSURANCE_TYPES = [VehicleDocument.Type.GSIS_INSURANCE, VehicleDocument.Type.INSURANCE_POLICY]


def _month_start(d):
    return d.replace(day=1)


def _add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


def _aware(d):
    return timezone.make_aware(datetime.combine(d, time.min))


class DashboardView(APIView):
    """Operational dashboard figures for the user's offices (or one office with `?office=`)."""

    def get(self, request):
        user = request.user
        self.today = timezone.localdate()
        self.office = self._office_param(request)
        self.start = self._month_param(request)
        self.end = _add_months(self.start, 1)  # exclusive

        def scoped(qs, field):
            qs = scope_to_offices(qs, user, field)
            return qs.filter(**{field: self.office}) if self.office else qs

        out = {'month': self.start.strftime('%Y-%m'), 'office': self.office, 'today': self.today}
        activity = []
        if user.has_perm('fleet.view_vehicle'):
            vehicles = scoped(Vehicle.objects.filter(is_archived=False), 'office')
            out['vehicles'] = self._vehicles(vehicles)
            activity += self._vehicle_activity(vehicles)
        if user.has_perm('fleet.view_vehicledocument'):
            docs = scoped(VehicleDocument.objects.filter(status=VehicleDocument.Status.ACTIVE), 'vehicle__office')
            out['renewals'] = {'lto': self._renewals(docs, LTO_TYPES), 'insurance': self._renewals(docs, INSURANCE_TYPES),
                               'window_days': max(documents.thresholds())}
            activity += self._document_activity(scoped(VehicleDocument.objects.all(), 'vehicle__office'))
        if user.has_perm('maintenance.view_maintenanceschedule'):
            out['maintenance_due'] = self._maintenance_due(scoped(MaintenanceSchedule.objects.filter(is_active=True), 'vehicle__office'))
        if user.has_perm('fleet.view_driver'):
            out['licenses'] = self._licenses(scoped(Driver.objects.filter(is_active=True), 'office'))
        if user.has_perm('operations.view_fuelrecord'):
            fuel = scoped(FuelRecord.objects.all(), 'vehicle__office')
            out['fuel'] = self._fuel(fuel)
            activity += self._fuel_activity(fuel)
        if user.has_perm('maintenance.view_maintenancerecord'):
            records = scoped(MaintenanceRecord.objects.all(), 'vehicle__office')
            out['maintenance_cost'] = self._maintenance_cost(records)
            activity += self._maintenance_activity(records)
        if user.has_perm('operations.view_trip'):
            trips = scoped(Trip.objects.all(), 'vehicle__office')
            fleet = scoped(Vehicle.objects.filter(is_archived=False), 'office')
            out['utilization'] = self._utilization(trips, fleet)
            activity += self._trip_activity(trips)
        out['activity'] = sorted(activity, key=lambda a: a['at'], reverse=True)[:ACTIVITY]
        return Response(out)

    # ---- params --------------------------------------------------------------------------------

    def _office_param(self, request):
        raw = request.query_params.get('office')
        if not raw:
            return None
        if not raw.isdigit() or not Office.objects.filter(pk=raw).exists():
            raise ValidationError({'office': ['Unknown office.']})
        return int(raw)  # an office outside the user's scope simply yields zeros (scope_to_offices runs first)

    def _month_param(self, request):
        raw = request.query_params.get('month')
        if not raw:
            return _month_start(self.today)
        try:
            return datetime.strptime(raw, '%Y-%m').date()
        except ValueError:
            raise ValidationError({'month': ['Use YYYY-MM.']})

    def _months(self):
        """The trend window: the selected month and the TREND_MONTHS - 1 before it, oldest first."""
        return [_add_months(self.start, -i) for i in range(TREND_MONTHS - 1, -1, -1)]

    # ---- sections ------------------------------------------------------------------------------

    def _vehicles(self, qs):
        S = Vehicle.Status
        by_status = {k: 0 for k, _ in S.choices}
        by_status.update(dict(qs.order_by().values_list('status').annotate(n=Count('id'))))
        rows = (qs.order_by().values('office', 'office__code', 'office__name')
                .annotate(total=Count('id'), **{s.lower(): Count('id', filter=Q(status=s)) for s in S.values})
                .order_by('-total', 'office__code'))
        return {'total': sum(by_status.values()), 'by_status': by_status, 'by_office': [
            {'office': r['office'], 'code': r['office__code'], 'name': r['office__name'], 'total': r['total'],
             'by_status': {s: r[s.lower()] for s in S.values}} for r in rows]}

    def _renewals(self, docs, types):
        qs = docs.filter(document_type__in=types).select_related('vehicle')
        window = self.today + timedelta(days=max(documents.thresholds()))
        agg = qs.order_by().aggregate(expired=Count('id', filter=Q(expiry_date__lt=self.today)),
                                      due=Count('id', filter=Q(expiry_date__gte=self.today, expiry_date__lte=window)))
        items = qs.filter(expiry_date__lte=window).order_by('expiry_date', 'id')[:ITEMS]
        return {**agg, 'items': [{
            'id': d.id, 'vehicle': d.vehicle_id, 'plate_number': d.vehicle.plate_number,
            'vehicle_label': f'{d.vehicle.make} {d.vehicle.model}', 'document_type': d.document_type,
            'document_type_display': d.get_document_type_display(), 'expiry_date': d.expiry_date,
            **documents.expiry_state(d.expiry_date, self.today)} for d in items]}

    def _maintenance_due(self, qs):
        # Same Python evaluation as /maintenance-schedules/summary/ (schedule_state is the one rule).
        counts = {'OVERDUE': 0, 'DUE_SOON': 0}
        items = []
        for s in qs.select_related('vehicle', 'category'):
            st = maintenance_service.schedule_state(s, self.today)
            if st['status'] in counts:
                counts[st['status']] += 1
                items.append({'id': s.id, 'vehicle': s.vehicle_id, 'plate_number': s.vehicle.plate_number,
                              'category': s.category.name, **st})
        # Overdue first, then by days left, then km left (a rule may have only one of the two).
        far = float('inf')
        urgency = lambda i: (i['status'] != 'OVERDUE', far if i['days_left'] is None else i['days_left'],
                             far if i['km_left'] is None else i['km_left'])
        return {'overdue': counts['OVERDUE'], 'due_soon': counts['DUE_SOON'], 'items': sorted(items, key=urgency)[:ITEMS]}

    def _licenses(self, qs):
        soon = self.today + timedelta(days=Driver.EXPIRING_DAYS)
        agg = qs.order_by().aggregate(expired=Count('id', filter=Q(license_expiry_date__lt=self.today)),
                                      expiring=Count('id', filter=Q(license_expiry_date__gte=self.today, license_expiry_date__lte=soon)))
        items = qs.filter(license_expiry_date__lte=soon).order_by('license_expiry_date', 'id')[:ITEMS]
        return {**agg, 'window_days': Driver.EXPIRING_DAYS, 'items': [{
            'id': d.id, 'full_name': d.full_name, 'license_expiry_date': d.license_expiry_date,
            'days_left': (d.license_expiry_date - self.today).days, 'license_status': d.license_status(self.today)} for d in items]}

    def _fuel(self, qs):
        months = self._months()
        rows = {r['m'].strftime('%Y-%m'): r for r in qs.filter(date__gte=months[0], date__lt=self.end).order_by()
                .annotate(m=TruncMonth('date')).values('m').annotate(amount=Sum('total_amount'), liters=Sum('liters'), n=Count('id'))}
        trend = [{'month': m.strftime('%Y-%m'), 'amount': money(rows.get(m.strftime('%Y-%m'), {}).get('amount')),
                  'liters': qty(rows.get(m.strftime('%Y-%m'), {}).get('liters')),
                  'count': rows.get(m.strftime('%Y-%m'), {}).get('n', 0)} for m in months]
        return {**trend[-1], 'previous_amount': trend[-2]['amount'], 'months': trend}

    def _maintenance_cost(self, qs):
        # Completed work by record date: the same figure as /maintenance/?status=COMPLETED&date_from..date_to.
        months = self._months()
        done = qs.filter(status=MaintenanceRecord.Status.COMPLETED, date__gte=months[0], date__lt=self.end).order_by()
        rows = {r['m'].strftime('%Y-%m'): r for r in done.annotate(m=TruncMonth('date')).values('m')
                .annotate(labor=Sum('labor_cost'), parts=Sum('parts_cost'), n=Count('id'))}

        def total(r):
            return Decimal(str(r.get('labor') or 0)) + Decimal(str(r.get('parts') or 0))
        trend = [{'month': m.strftime('%Y-%m'), 'amount': money(total(rows.get(m.strftime('%Y-%m'), {}))),
                  'count': rows.get(m.strftime('%Y-%m'), {}).get('n', 0)} for m in months]
        return {**trend[-1], 'previous_amount': trend[-2]['amount'], 'months': trend,
                'open': qs.filter(status__in=maintenance_service.OPEN).count()}

    def _utilization(self, trips, fleet):
        """
        Completed trips that left in the month (as /trips/?status=COMPLETED&date_from..date_to counts them), the
        km driven, and how many of the operable fleet (not disposed / unserviceable) made at least one trip.
        """
        S = Vehicle.Status
        done = trips.filter(status=Trip.Status.COMPLETED, departed_at__gte=_aware(self.start), departed_at__lt=_aware(self.end)).order_by()
        agg = done.aggregate(trips=Count('id'), km=Sum('distance_km'), vehicles=Count('vehicle', distinct=True))
        operable = fleet.exclude(status__in=[S.DISPOSED, S.UNSERVICEABLE]).count()
        top = (done.values('vehicle', 'vehicle__plate_number', 'vehicle__make', 'vehicle__model')
               .annotate(trips=Count('id'), km=Sum('distance_km')).order_by(F('km').desc(nulls_last=True), '-trips')[:ITEMS])
        now = timezone.now()
        return {
            'trips': agg['trips'], 'distance_km': agg['km'] or 0, 'vehicles_used': agg['vehicles'], 'operable': operable,
            'rate': round(100 * agg['vehicles'] / operable) if operable else None,
            'on_trip': trips.filter(status=Trip.Status.DISPATCHED).count(),
            'scheduled_next_7_days': trips.filter(status=Trip.Status.SCHEDULED, scheduled_departure__gte=now,
                                                  scheduled_departure__lt=now + timedelta(days=7)).count(),
            'top_vehicles': [{'vehicle': t['vehicle'], 'plate_number': t['vehicle__plate_number'],
                              'label': f"{t['vehicle__make']} {t['vehicle__model']}", 'trips': t['trips'],
                              'distance_km': t['km'] or 0} for t in top],
        }

    # ---- recent activity -----------------------------------------------------------------------
    # Built from the office-scoped records themselves (the audit log has no office), newest first.

    def _vehicle_activity(self, qs):
        return [{'kind': 'vehicle', 'at': v.created_at, 'link': f'/vehicles/{v.id}', 'plate_number': v.plate_number,
                 'text': f'Vehicle added: {v.make} {v.model}'} for v in qs.order_by('-created_at')[:ACTIVITY]]

    def _document_activity(self, qs):
        return [{'kind': 'document', 'at': d.created_at, 'link': f'/documents/{d.id}', 'plate_number': d.vehicle.plate_number,
                 'text': f'{d.get_document_type_display()} recorded' + (f', expires {d.expiry_date:%b %d, %Y}' if d.expiry_date else '')}
                for d in qs.select_related('vehicle').order_by('-created_at')[:ACTIVITY]]

    def _fuel_activity(self, qs):
        return [{'kind': 'fuel', 'at': r.created_at, 'link': f'/fuel/{r.id}', 'plate_number': r.vehicle.plate_number,
                 'text': f'Fuel: {r.liters.normalize():f} L, ₱{r.total_amount:,.2f}'}
                for r in qs.select_related('vehicle').order_by('-created_at')[:ACTIVITY]]

    def _maintenance_activity(self, qs):
        return [{'kind': 'maintenance', 'at': r.updated_at, 'link': f'/maintenance/{r.id}', 'plate_number': r.vehicle.plate_number,
                 'text': f'Maintenance {r.get_status_display().lower()}: {r.description[:60]}'}
                for r in qs.select_related('vehicle').order_by('-updated_at')[:ACTIVITY]]

    def _trip_activity(self, qs):
        verb = {'SCHEDULED': 'Trip scheduled to', 'DISPATCHED': 'Dispatched to', 'COMPLETED': 'Returned from', 'CANCELLED': 'Trip cancelled to'}
        return [{'kind': 'trip', 'at': t.updated_at, 'link': f'/trips/{t.id}', 'plate_number': t.vehicle.plate_number,
                 'text': f'{verb[t.status]} {t.destination}'}
                for t in qs.select_related('vehicle').order_by('-updated_at')[:ACTIVITY]]
