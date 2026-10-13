from django.conf import settings
from django.contrib import admin
from django.utils.html import format_html

from .models import DisplayScreen, FuelRecord, RFIDAccount, TollTransaction, Trip

admin.site.register([Trip, FuelRecord, RFIDAccount, TollTransaction])


@admin.register(DisplayScreen)
class DisplayScreenAdmin(admin.ModelAdmin):
    """Create a screen, then open the display link on the TV. Untick "is active" to revoke it."""
    list_display = ('name', 'office', 'is_active', 'last_seen_at', 'display_link')
    list_filter = ('is_active', 'office')
    readonly_fields = ('display_link', 'created_at', 'last_seen_at')

    @admin.display(description='Display link (open on the TV)')
    def display_link(self, obj):
        if not obj.pk:
            return 'Save first to generate the link.'
        url = f'{settings.FRONTEND_URL}/display?token={obj.token}'
        return format_html('<a href="{}" target="_blank" rel="noopener">{}</a>', url, url)
