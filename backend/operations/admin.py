from django.contrib import admin

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
        return f'/display?token={obj.token}' if obj.pk else 'Save first to generate the link.'
