"""Liveness/readiness check for the container healthcheck and uptime monitors. Public, says nothing but ok/error."""
import logging
import os

from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

logger = logging.getLogger(__name__)


@never_cache
@require_GET
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
        if not os.access(settings.MEDIA_ROOT, os.W_OK):
            raise OSError('MEDIA_ROOT is not writable')
    except Exception:
        logger.exception('Health check failed')  # details go to the log only, never to the caller
        return JsonResponse({'status': 'error'}, status=503)
    return JsonResponse({'status': 'ok'})
