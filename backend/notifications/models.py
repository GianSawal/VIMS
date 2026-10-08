from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models


class Notification(models.Model):
    class Type(models.TextChoices):
        DOCUMENT_EXPIRY = 'DOCUMENT_EXPIRY', 'Document expiration'
        LTO_RENEWAL = 'LTO_RENEWAL', 'LTO renewal'
        INSURANCE_EXPIRY = 'INSURANCE_EXPIRY', 'GSIS/insurance expiration'
        LICENSE_EXPIRY = 'LICENSE_EXPIRY', 'Driver license expiration'
        MAINTENANCE_DUE = 'MAINTENANCE_DUE', 'Maintenance due'
        MAINTENANCE_OVERDUE = 'MAINTENANCE_OVERDUE', 'Maintenance overdue'
        ASSIGNMENT = 'ASSIGNMENT', 'Assignment'

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    type = models.CharField(max_length=30, choices=Type.choices)
    title = models.CharField(max_length=200)
    message = models.TextField()
    content_type = models.ForeignKey(ContentType, null=True, blank=True, on_delete=models.SET_NULL)
    object_id = models.PositiveBigIntegerField(null=True, blank=True)
    related_object = GenericForeignKey('content_type', 'object_id')
    # e.g. "doc:42:30d". Unique per recipient, so a threshold alert can only be created once.
    dedupe_key = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.UniqueConstraint(fields=['recipient', 'dedupe_key'], name='uniq_notification_per_event')]
        indexes = [models.Index(fields=['recipient', 'read_at'])]
