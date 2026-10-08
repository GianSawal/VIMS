"""Supporting-file endpoints shared by any viewset whose records can carry attachments (drivers, trips, ...)."""
import os

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.permissions import PasswordChangeNotRequired
from audit.services import log

from .driver_serializers import AttachmentSerializer, AttachmentUploadSerializer
from .models import Attachment

ACTION_PERMS = [IsAuthenticated, PasswordChangeNotRequired]


class AttachmentsMixin:
    """
    GET/POST  {detail}/attachments/            list or upload (multipart `file`, `description`)
    DELETE    {detail}/attachments/{att_id}/   remove
    Reading needs view_<model>; changing needs change_<model>. get_object() applies office scoping.
    """

    def _perm(self, action_name):
        meta = self.get_queryset().model._meta
        return f'{meta.app_label}.{action_name}_{meta.model_name}'

    def _require(self, action_name):
        if not self.request.user.has_perm(self._perm(action_name)):
            raise PermissionDenied('You do not have permission to perform this action.')

    def _attachments(self, obj):
        ct = ContentType.objects.get_for_model(obj)
        return Attachment.objects.filter(content_type=ct, object_id=obj.pk).select_related('uploaded_by').order_by('-id')

    @action(detail=True, methods=['get', 'post'], parser_classes=[MultiPartParser, FormParser], permission_classes=ACTION_PERMS)
    def attachments(self, request, pk=None):
        self._require('view')
        obj = self.get_object()
        if request.method == 'GET':
            return Response(AttachmentSerializer(self._attachments(obj), many=True).data)

        self._require('change')
        s = AttachmentUploadSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        f = s.validated_data['file']
        att = Attachment.objects.create(
            content_type=ContentType.objects.get_for_model(obj), object_id=obj.pk, file=f,
            original_name=os.path.basename(f.name)[:255], size=f.size,
            description=s.validated_data['description'], uploaded_by=request.user)
        log(request, 'attachment_add', obj, f'Added attachment "{att.original_name}" to {obj._meta.verbose_name} {obj}')
        return Response(AttachmentSerializer(att).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'attachments/(?P<att_id>\d+)', permission_classes=ACTION_PERMS)
    def delete_attachment(self, request, pk=None, att_id=None):
        self._require('change')
        obj = self.get_object()
        att = get_object_or_404(self._attachments(obj), pk=att_id)
        name, storage, path = att.original_name, att.file.storage, att.file.name
        att.delete()
        transaction.on_commit(lambda: storage.delete(path))
        log(request, 'attachment_remove', obj, f'Removed attachment "{name}" from {obj._meta.verbose_name} {obj}')
        return Response(status=status.HTTP_204_NO_CONTENT)
