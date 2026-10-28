import io

from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from accounts.permissions import PasswordChangeNotRequired, require

from .importer import write_template

XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


class ImportTemplateView(APIView):
    """The blank standard import workbook (same file as `import_workbook --template`). The import itself stays on the
    server command line, where it gets a dry run and a review before --commit (docs/MIGRATION.md)."""
    permission_classes = [IsAuthenticated, require('accounts.import_data'), PasswordChangeNotRequired]

    def get(self, request):
        buf = io.BytesIO()
        write_template(buf)
        response = HttpResponse(buf.getvalue(), content_type=XLSX)
        response['Content-Disposition'] = 'attachment; filename="vrs-import-template.xlsx"'
        return response
