from django.contrib import admin

from .models import MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule

admin.site.register([MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule])
