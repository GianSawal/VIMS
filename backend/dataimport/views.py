import io
from pathlib import Path

from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from accounts.permissions import PasswordChangeNotRequired, require

from .importer import write_template

XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
# Blank VEHICLE RECORD form (RO3's own layout plus the columns the import needs), built by legacy.blank_form.
FORM = Path(__file__).parent / 'forms' / 'vehicle-record-form.xlsx'


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
