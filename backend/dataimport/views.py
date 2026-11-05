import io
from datetime import date

from django.http import HttpResponse
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import PasswordChangeNotRequired, require
from accounts.throttles import ExportThrottle
from audit import services as audit

from . import purge
from .export import export_form
from .importer import write_template
from .legacy import FORM

XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


class ImportTemplateView(APIView):
    """GET: the blank VEHICLE RECORD form; ?kind=standard: the standard import workbook (`--template`).
    The import itself stays on the server command line, where it gets a dry run and a review before --commit
    (docs/MIGRATION.md)."""
    permission_classes = [IsAuthenticated, require('accounts.import_data'), PasswordChangeNotRequired]

    def get(self, request):
        if request.query_params.get('kind') == 'standard':
            buf = io.BytesIO()
            write_template(buf)
            content, name = buf.getvalue(), 'vrs-import-template.xlsx'
        else:
            content, name = FORM.read_bytes(), 'VEHICLE RECORD form.xlsx'
        response = HttpResponse(content, content_type=XLSX)
        response['Content-Disposition'] = f'attachment; filename="{name}"'
        return response


class RecordsFormView(APIView):
    """GET: the VEHICLE RECORD form filled with the system's records (?office=<id> for one office). Each section needs
    its own view permission and only the user's offices are included (export.export_form)."""
    permission_classes = [IsAuthenticated, require('fleet.view_vehicle'), PasswordChangeNotRequired]
    throttle_classes = [ExportThrottle]

    def get(self, request):
        office = request.query_params.get('office') or None
        if office and not office.isdigit():
            raise ValidationError({'office': 'Office id must be a number.'})
        content, count = export_form(request.user, office)
        audit.log(request, 'export', 'vehicle', f'Exported the VEHICLE RECORD workbook ({count} vehicles)', {'office': office})
        response = HttpResponse(content, content_type=XLSX)
        response['Content-Disposition'] = f'attachment; filename="VEHICLE RECORD {date.today():%Y-%m-%d}.xlsx"'
        return response


class PurgeView(APIView):
    """GET: row counts per group. POST {groups: [...], confirm: 'DELETE'}: delete those groups (purge.py).
    For clearing test data before go-live; needs accounts.purge_test_data (System Administrator only)."""
    permission_classes = [IsAuthenticated, require('accounts.purge_test_data'), PasswordChangeNotRequired]

    def get(self, request):
        counts = purge.counts()
        return Response([{'key': k, 'label': label, 'count': counts[k]} for k, (label, _) in purge.GROUPS.items()])

    def post(self, request):
        groups = request.data.get('groups')
        if not isinstance(groups, list) or not groups or not set(groups) <= set(purge.GROUPS):
            raise ValidationError({'groups': 'Choose at least one kind of data.'})
        if request.data.get('confirm') != 'DELETE':
            raise ValidationError({'confirm': 'Type DELETE to confirm.'})
        deleted = purge.purge(groups)
        audit.log(request, 'purge', 'test data', f'Deleted test data: {", ".join(groups)}', {'deleted': deleted})
        return Response({'deleted': deleted})
