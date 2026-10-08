from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Append-only. No update/delete paths in the API or admin."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    username = models.CharField(max_length=150, blank=True, help_text='Snapshot; survives user rename/deletion.')
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    action = models.CharField(max_length=30, db_index=True, help_text='create / update / archive / delete / login ...')
    entity_type = models.CharField(max_length=60, db_index=True)
    entity_id = models.CharField(max_length=40, blank=True)
    description = models.CharField(max_length=500)
    changes = models.JSONField(default=dict, blank=True, help_text='{"field": [old, new]}')
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [models.Index(fields=['entity_type', 'entity_id'])]
