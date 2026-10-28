"""
/media/<path>: uploaded files, served only to people allowed to see the record they belong to.

- Vehicle and driver photos are public (the logged-out TV board shows them; their names are random).
- Vehicle documents need fleet.view_vehicledocument and the vehicle's office.
- Attachments need view_<model> of the record they hang on and that record's office (the same office scoping as
  the record's own API, taken from its viewset).
- Anything else under MEDIA_ROOT that no record points at is never served.

Logged out = 401, no permission = 403, out of office or unknown = 404. In production set MEDIA_ACCEL_REDIRECT
(e.g. /protected-media/) so Nginx sends the file after this check (docs/SECURITY.md); otherwise Django streams it.
"""
import mimetypes
import posixpath
from urllib.parse import quote

from django.conf import settings
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404, HttpResponse

from accounts.permissions import scope_to_offices
from fleet.models import Attachment, Driver, Vehicle, VehicleDocument


def _office_fields():
    """model -> office_field, from the API router, so files follow exactly the record's own office rule."""
    from config.urls import router
    return {vs.queryset.model: getattr(vs, 'office_field', None) for _, vs, _ in router.registry
            if getattr(vs, 'queryset', None) is not None}


def _can_see(user, model, pk):
    meta = model._meta
    if not user.has_perm(f'{meta.app_label}.view_{meta.model_name}'):
        return 403
    fields = _office_fields()
    if model not in fields:
        return 404  # a record type with no API: nobody downloads its files through here
    return 200 if scope_to_offices(model.objects.filter(pk=pk), user, fields[model]).exists() else 404


def _check(request, name):
    """(status, download name) for a protected file; (200, None) for a public photo."""
    if Vehicle.objects.filter(photo=name).exists() or Driver.objects.filter(photo=name).exists():
        return 200, None
    doc = VehicleDocument.objects.filter(file=name).only('pk').first()
    att = None if doc else Attachment.objects.filter(file=name).select_related('content_type').first()
    if not doc and not att:
        return 404, None
    user = request.user
    if not user.is_authenticated:
        return 401, None
    if user.must_change_password:
        return 403, None
    if doc:
        return _can_see(user, VehicleDocument, doc.pk), name.rsplit('/', 1)[-1]
    model = att.content_type.model_class()
    if model is None:
        return 404, None
    return _can_see(user, model, att.object_id), att.original_name


def serve_media(request, path):
    name = posixpath.normpath(path)
    if name != path or name.startswith(('..', '/')):
        raise Http404
    code, download_name = _check(request, name)
    if code == 404:
        raise Http404
    if code != 200:
        return HttpResponse(status=code)

    accel = getattr(settings, 'MEDIA_ACCEL_REDIRECT', '')
    if accel:
        response = HttpResponse(content_type=mimetypes.guess_type(name)[0] or 'application/octet-stream')
        response['X-Accel-Redirect'] = accel.rstrip('/') + '/' + quote(name)
    else:
        if not default_storage.exists(name):
            raise Http404
        response = FileResponse(default_storage.open(name, 'rb'))
    response['X-Content-Type-Options'] = 'nosniff'
    if download_name is None:
        response['Cache-Control'] = 'public, max-age=86400'  # photos get a new name when replaced
    else:
        response['Cache-Control'] = 'private, no-store'
        response['Content-Disposition'] = f"inline; filename*=UTF-8''{quote(download_name)}"
    return response
