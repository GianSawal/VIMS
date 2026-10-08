from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from accounts.views import OfficeViewSet, UserViewSet
from fleet.driver_views import DriverViewSet
from fleet.views import VehicleViewSet
from operations.views import TripViewSet

router = DefaultRouter()
router.register('offices', OfficeViewSet)
router.register('users', UserViewSet)
router.register('vehicles', VehicleViewSet)
router.register('drivers', DriverViewSet)
router.register('trips', TripViewSet)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/', include(router.urls)),
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
