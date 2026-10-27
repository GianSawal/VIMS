from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.permissions import PasswordChangeNotRequired, SessionAuth

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source='get_type_display', read_only=True)
    is_read = serializers.SerializerMethodField()
    link = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ['id', 'type', 'type_display', 'title', 'message', 'created_at', 'read_at', 'is_read', 'link']

    def get_is_read(self, obj):
        return obj.read_at is not None

    def get_link(self, obj):
        # Frontend route to the record the alert is about. ponytail: fetches related_object per row (N+1);
        # a list page is ~20 rows, so fine — revisit with a prefetch if it grows.
        o = obj.related_object
        if o is None:
            return None
        model = obj.content_type.model
        if model == 'vehicledocument':
            return f'/vehicles/{o.vehicle_id}?tab=documents'
        if model == 'maintenanceschedule':
            return f'/vehicles/{o.vehicle_id}?tab=maintenance'
        if model == 'driver':
            return f'/drivers/{o.pk}'
        return None


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    The current user's own notifications only (never anyone else's). Not dismissed.
    POST /{id}/read/, /{id}/dismiss/, /read-all/ and GET /unread-count/.
    """
    serializer_class = NotificationSerializer
    authentication_classes = [SessionAuth]
    permission_classes = [IsAuthenticated, PasswordChangeNotRequired]
    filterset_fields = ['type', 'read_at']

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user, dismissed_at__isnull=True)

    @action(detail=False, url_path='unread-count')
    def unread_count(self, request):
        return Response({'count': self.get_queryset().filter(read_at__isnull=True).count()})

    @action(detail=True, methods=['post'])
    def read(self, request, pk=None):
        n = self.get_object()
        if n.read_at is None:
            n.read_at = timezone.now()
            n.save(update_fields=['read_at'])
        return Response(self.get_serializer(n).data)

    @action(detail=False, methods=['post'], url_path='read-all')
    def read_all(self, request):
        updated = self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({'updated': updated})

    @action(detail=True, methods=['post'])
    def dismiss(self, request, pk=None):
        n = self.get_object()
        n.dismissed_at = timezone.now()
        if n.read_at is None:
            n.read_at = n.dismissed_at
        n.save(update_fields=['dismissed_at', 'read_at'])
        return Response(status=204)
