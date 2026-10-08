from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Office, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = BaseUserAdmin.fieldsets + (('VIMS', {'fields': ('offices', 'must_change_password')}),)
    filter_horizontal = ('offices', 'groups', 'user_permissions')


@admin.register(Office)
class OfficeAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'office_type', 'parent', 'is_active')
    list_filter = ('office_type', 'is_active')
    search_fields = ('code', 'name')
