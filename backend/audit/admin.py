from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('timestamp', 'username', 'action', 'entity_type', 'entity_id', 'description')
    list_filter = ('action', 'entity_type')
    search_fields = ('username', 'description', 'entity_id')

    # Read-only: audit entries are never edited or removed.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
