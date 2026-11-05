"""Permanently delete a master record entered by mistake (vehicle, driver, RFID account), System Administrator only.

The no-DELETE rule still holds for records with history: the database's PROTECT foreign keys refuse the delete while
any trip, fuel, maintenance, assignment, document or toll row points at the record, and the API answers 400 naming
them (archive or deactivate instead). It is a POST action, not HTTP DELETE, so it can't be reached by accident."""
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import FileField, ProtectedError
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from accounts.permissions import PasswordChangeNotRequired
from audit.services import log


class CanDelete(BasePermission):
    """Django's delete_<model> permission for the viewset's model (only System Administrator holds these)."""
    message = 'Only a System Administrator can delete records.'

    def has_permission(self, request, view):
        meta = view.queryset.model._meta
        return request.user.is_authenticated and request.user.has_perm(f'{meta.app_label}.delete_{meta.model_name}')


class RemoveMixin:
    def remove_label(self, obj):
        """How the record is named in the message and the audit log; override to mask secrets."""
        return str(obj)

    @action(detail=True, methods=['post'], permission_classes=[CanDelete, PasswordChangeNotRequired])
    def remove(self, request, pk=None):
        from fleet.models import Attachment  # fleet imports this module's app; avoid the cycle at import time
        obj = self.get_object()  # office check (404) first
        label = self.remove_label(obj)
        files = [(f.storage, getattr(obj, f.name).name) for f in obj._meta.fields if isinstance(f, FileField) and getattr(obj, f.name)]
        attachments = Attachment.objects.filter(content_type=ContentType.objects.get_for_model(obj), object_id=obj.pk)
        files += [(a.file.storage, a.file.name) for a in attachments]
        try:
            with transaction.atomic():
                log(request, 'delete', obj, f'Deleted {obj._meta.verbose_name} {label} (entered by mistake, no history)')
                attachments.delete()
                obj.delete()
        except ProtectedError as e:
            kinds = sorted({str(o._meta.verbose_name_plural) for o in e.protected_objects})
            raise serializers.ValidationError(
                f'{label} cannot be deleted because it has {", ".join(kinds)} on record. Archive or deactivate it instead.')
        transaction.on_commit(lambda: [storage.delete(name) for storage, name in files])
        return Response(status=status.HTTP_204_NO_CONTENT)
