from django.contrib import admin

from .models import Attachment, Driver, Vehicle, VehicleAssignment, VehicleDocument


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ('plate_number', 'make', 'model', 'office', 'status', 'current_odometer', 'is_archived')
    list_filter = ('status', 'office', 'vehicle_type', 'is_archived')
    search_fields = ('plate_number', 'property_number', 'engine_number', 'chassis_number', 'make', 'model')


@admin.register(Driver)
class DriverAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'office', 'license_number', 'license_expiry_date', 'is_active')
    list_filter = ('office', 'is_active')
    search_fields = ('full_name', 'employee_number', 'license_number')


admin.site.register(VehicleAssignment)
admin.site.register(VehicleDocument)
admin.site.register(Attachment)
