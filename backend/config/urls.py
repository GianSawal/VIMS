from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from accounts.views import OfficeViewSet, UserViewSet
from audit.views import AuditLogViewSet
from config.health import health
from config.media import serve_media
from dashboard.views import DashboardView
from dataimport.views import ImportTemplateView, RecordsFormView
from fleet.document_views import DocumentViewSet
from fleet.driver_views import DriverViewSet
from fleet.views import VehicleViewSet
from maintenance.views import CategoryViewSet, MaintenanceRecordViewSet, ScheduleViewSet
from notifications.api import NotificationViewSet
from operations.views import (DisplayScreenViewSet, DisplayTripsView, FuelRecordViewSet, MapsView,
                              RFIDAccountViewSet, TollTransactionViewSet, TripViewSet)
from reports.views import ReportListView, ReportView

router = DefaultRouter()
router.register('offices', OfficeViewSet)
router.register('users', UserViewSet)
router.register('vehicles', VehicleViewSet)
router.register('drivers', DriverViewSet)
router.register('documents', DocumentViewSet)
router.register('trips', TripViewSet)
router.register('display-screens', DisplayScreenViewSet)
router.register('fuel-records', FuelRecordViewSet)
router.register('rfid-accounts', RFIDAccountViewSet)
router.register('toll-transactions', TollTransactionViewSet)
router.register('maintenance-categories', CategoryViewSet)
router.register('maintenance-schedules', ScheduleViewSet)
router.register('maintenance', MaintenanceRecordViewSet)
router.register('notifications', NotificationViewSet, basename='notification')
router.register('audit-logs', AuditLogViewSet)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health, name='health'),  # public: container healthcheck and uptime monitor
    path('api/auth/', include('accounts.urls')),
    path('api/dashboard/', DashboardView.as_view(), name='dashboard'),
    path('api/reports/', ReportListView.as_view(), name='reports'),
    path('api/reports/<slug:slug>/', ReportView.as_view(), name='report'),
    path('api/display/trips/', DisplayTripsView.as_view(), name='display-trips'),
    path('api/maps/<str:op>/', MapsView.as_view(), name='maps'),  # status | autocomplete | route
    path('api/import/template/', ImportTemplateView.as_view(), name='import-template'),
    path('api/export/vehicle-record/', RecordsFormView.as_view(), name='export-vehicle-record'),
    path('api/', include(router.urls)),
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger'),
    # Uploaded files, with the record's permission and office check (config/media.py), in every environment.
    re_path(rf'^{settings.MEDIA_URL.strip("/")}/(?P<path>.+)$', serve_media, name='media'),
]
