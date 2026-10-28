"""
Phase 14 audit-log API: read-only, newest first. GET /api/audit-logs/, /api/audit-logs/{id}/, /api/audit-logs/facets/.

Needs audit.view_auditlog, which seed_reference gives only to System Administrator. Entries are system-wide
(the log has no office), so the permission must not be granted to office-limited roles.
There is no create/update/delete route: entries are written only by audit.services.log().
"""
from django.db.models import Count
from django_filters import rest_framework as filters
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import ModelPermissions, PasswordChangeNotRequired

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = ['id', 'timestamp', 'user', 'username', 'action', 'entity_type', 'entity_id', 'description',
                  'changes', 'ip_address', 'user_agent']
        read_only_fields = fields


class AuditLogFilter(filters.FilterSet):
    date_from = filters.DateFilter(field_name='timestamp', lookup_expr='date__gte')
    date_to = filters.DateFilter(field_name='timestamp', lookup_expr='date__lte')

    class Meta:
        model = AuditLog
        fields = ['action', 'entity_type', 'entity_id', 'user', 'username']


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [ModelPermissions, PasswordChangeNotRequired]
    filterset_class = AuditLogFilter
    search_fields = ['description', 'username', 'entity_id', 'action']
    ordering_fields = ['timestamp']
    ordering = ['-timestamp', '-id']

    @action(detail=False, methods=['get'])
    def facets(self, request):
        """Values for the filter dropdowns, with counts: actions, entity types and users seen in the log."""
        qs = AuditLog.objects.order_by()
        count = lambda field: [{'value': r[field], 'count': r['n']}
                               for r in qs.values(field).annotate(n=Count('id')).order_by(field) if r[field]]
        return Response({'actions': count('action'), 'entity_types': count('entity_type'), 'usernames': count('username')})
