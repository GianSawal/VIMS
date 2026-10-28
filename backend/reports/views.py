"""
GET /api/reports/                     reports this user may run, with the filters each one takes
GET /api/reports/<slug>/?<filters>    preview as JSON (first PREVIEW_ROWS rows; `full=1` for all, used by the print view)
GET /api/reports/<slug>/?export=csv|xlsx|pdf   download; logged in the audit trail

Filters: office, vehicle, driver, status, category, group_by, date_from, date_to (YYYY-MM-DD).
A vehicle or driver outside the user's offices answers 404, as on their detail pages.
"""
from datetime import date
from decimal import Decimal

from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Office
from accounts.permissions import scope_to_offices
from accounts.throttles import ExportThrottle
from audit import services as audit
from fleet.models import Driver, Vehicle
from maintenance.models import MaintenanceCategory

from .catalog import REPORTS, Ctx
from .export import EXPORTERS

PREVIEW_ROWS = 1000
QUANT = {'money': Decimal('0.01'), 'num': Decimal('0.01'), 'qty': Decimal('0.001'), 'pct': Decimal('0.1')}


def statuses(rep):
    return list(rep.statuses() if callable(rep.statuses) else rep.statuses)


def meta(rep):
    return {'slug': rep.slug, 'title': rep.title, 'group': rep.group, 'description': rep.description,
            'filters': list(rep.filters), 'required': list(rep.required), 'default_period': rep.default_period,
            'period_label': rep.period_label,
            'statuses': [{'value': v, 'label': label} for v, label in statuses(rep)],
            'group_by': [{'value': v, 'label': label} for v, label in rep.group_by]}


def _id(p, key):
    v = p.get(key)
    if not v:
        return None
    try:
        return int(v)
    except ValueError:
        raise ValidationError({key: 'Must be a number.'})


def _date(p, key):
    v = p.get(key)
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise ValidationError({key: 'Use YYYY-MM-DD.'})


def parse(rep, request, today):
    """Validated filters for `rep` plus the human-readable list printed on the report."""
    p, user, allowed = request.query_params, request.user, set(rep.filters)
    out, shown = {}, []
    if 'office' in allowed and (pk := _id(p, 'office')):
        out['office'] = Office.objects.filter(pk=pk).first()
        if not out['office']:
            raise ValidationError({'office': 'Unknown office.'})
        shown.append(('Office', str(out['office'])))
    if 'vehicle' in allowed and (pk := _id(p, 'vehicle')):
        out['vehicle'] = scope_to_offices(Vehicle.objects.select_related('office'), user, 'office').filter(pk=pk).first()
        if not out['vehicle']:
            raise Http404
        shown.append(('Vehicle', str(out['vehicle'])))
    if 'driver' in allowed and (pk := _id(p, 'driver')):
        out['driver'] = scope_to_offices(Driver.objects.all(), user, 'office').filter(pk=pk).first()
        if not out['driver']:
            raise Http404
        shown.append(('Driver', out['driver'].full_name))
    if 'category' in allowed and (pk := _id(p, 'category')):
        out['category'] = MaintenanceCategory.objects.filter(pk=pk).first()
        if not out['category']:
            raise ValidationError({'category': 'Unknown category.'})
        shown.append(('Category', out['category'].name))
    if 'status' in allowed and (v := p.get('status')):
        labels = dict(statuses(rep))
        if v not in labels:
            raise ValidationError({'status': f'Choose one of: {", ".join(labels)}.'})
        out['status'] = v
        shown.append(('Status', labels[v]))
    if rep.group_by:
        groups = dict(rep.group_by)
        out['group_by'] = p.get('group_by') or rep.group_by[0][0]
        if out['group_by'] not in groups:
            raise ValidationError({'group_by': f'Choose one of: {", ".join(groups)}.'})
        shown.append(('Grouped by', groups[out['group_by']]))
    if 'period' in allowed:
        start, end = _date(p, 'date_from'), _date(p, 'date_to')
        if rep.default_period and not (start and end):
            end = end or today
            start = start or end.replace(day=1)
        if start and end and start > end:
            raise ValidationError({'date_to': 'Must be on or after the start date.'})
        out['date_from'], out['date_to'] = start, end
        if start or end:
            day = lambda d: f'{d:%b %d, %Y}' if d else 'any date'
            shown.append((rep.period_label, f'{day(start)} to {day(end)}'))
    missing = [f for f in rep.required if not out.get(f)]
    if missing:
        raise ValidationError({f: 'Required for this report.' for f in missing})
    return out, shown


def build_document(rep, request):
    today = timezone.localdate()
    params, shown = parse(rep, request, today)
    data = rep.build(Ctx(request.user, today, **params))
    user = request.user
    return {'slug': rep.slug, 'title': rep.title, 'group': rep.group, 'description': rep.description,
            'generated_at': timezone.localtime(), 'generated_by': user.get_full_name() or user.username,
            'filters': shown, 'params': {k: (v.pk if hasattr(v, 'pk') else v.isoformat() if isinstance(v, date) else v)
                                         for k, v in params.items() if v is not None},
            'count': len(data['rows']), **data}


def jsonable(value, kind):
    if value is None:
        return None
    if isinstance(value, Decimal) or kind in QUANT:
        return str(Decimal(str(value)).quantize(QUANT.get(kind, Decimal('0.01'))))
    if kind == 'datetime':
        return timezone.localtime(value).isoformat() if timezone.is_aware(value) else value.isoformat()
    return value


class ReportListView(APIView):
    """Reports the user may run (each needs the view permission of every module it reads)."""

    def get(self, request):
        return Response([meta(r) for r in REPORTS.values() if request.user.has_perms(r.perms)])


class ReportView(APIView):
    def get_throttles(self):
        return [ExportThrottle()] if self.request.query_params.get('export') else []  # previews aren't limited

    def get(self, request, slug):
        rep = REPORTS.get(slug)
        if not rep:
            raise Http404
        if not request.user.has_perms(rep.perms):
            raise PermissionDenied('You do not have permission to run this report.')
        doc = build_document(rep, request)
        fmt = request.query_params.get('export')
        if fmt:
            if fmt not in EXPORTERS:
                raise ValidationError({'export': f'Choose one of: {", ".join(EXPORTERS)}.'})
            audit.log(request, 'export', 'report', f'Exported "{rep.title}" as {fmt.upper()} ({doc["count"]} rows)',
                      {'report': rep.slug, 'format': fmt, 'filters': doc['params']})
            return EXPORTERS[fmt](doc)
        kinds = {c['key']: c['kind'] for c in doc['columns']}
        convert = lambda row: {k: jsonable(row.get(k), kind) for k, kind in kinds.items()}
        rows = doc['rows'] if request.query_params.get('full') else doc['rows'][:PREVIEW_ROWS]
        return Response({**doc, 'meta': meta(rep), 'rows': [convert(r) for r in rows], 'totals': convert(doc['totals']) if doc['totals'] else {},
                         'truncated': len(rows) < doc['count'], 'filters': [{'label': k, 'value': v} for k, v in doc['filters']]})
