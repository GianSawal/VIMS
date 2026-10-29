"""DOLE VRS settings. All secrets and environment-specific values come from .env."""
from pathlib import Path

import environ
import pymysql
from django.core.exceptions import ImproperlyConfigured

pymysql.install_as_MySQLdb()  # ponytail: pure-Python driver, swap to mysqlclient if perf matters

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / '.env')

SECRET_KEY = env('SECRET_KEY')
DEBUG = env('DEBUG')
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1'])

if not DEBUG and (len(SECRET_KEY) < 50 or SECRET_KEY.startswith(('change-me', 'django-insecure'))):
    raise ImproperlyConfigured('Production needs a long random SECRET_KEY in .env (see docs/SECURITY.md).')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'django_filters',
    'corsheaders',
    'drf_spectacular',
    'accounts',
    'fleet',
    'operations',
    'maintenance',
    'notifications',
    'audit',
    'dashboard',
    'reports',
    'dataimport',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': env.db('DATABASE_URL'),
}
if 'mysql' in DATABASES['default']['ENGINE']:
    DATABASES['default'].setdefault('OPTIONS', {})['charset'] = 'utf8mb4'

# Holds the rate-limit counters. With several gunicorn workers use a shared one, e.g. dbcache://vrs_cache
# (then `manage.py createcachetable`); the default in-memory cache counts per process.
CACHES = {'default': env.cache('CACHE_URL', default='locmemcache://')}

AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Manila'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = 'media/'
MEDIA_ROOT = env.path('MEDIA_ROOT', default=BASE_DIR / 'media')
FILE_UPLOAD_MAX_MEMORY_SIZE = env.int('FILE_UPLOAD_MAX_BYTES', default=5 * 1024 * 1024)
VEHICLE_PHOTO_MAX_BYTES = env.int('VEHICLE_PHOTO_MAX_BYTES', default=5 * 1024 * 1024)
ATTACHMENT_MAX_BYTES = env.int('ATTACHMENT_MAX_BYTES', default=10 * 1024 * 1024)
# Files go through config/media.py (permission + office check). With Nginx, set e.g. /protected-media/ (an `internal`
# location aliased to MEDIA_ROOT) and Nginx sends the file after the check; empty = Django streams it.
MEDIA_ACCEL_REDIRECT = env('MEDIA_ACCEL_REDIRECT', default='')
# Trip map (place search + routing on OpenStreetMap data), server-side keys. Empty = maps turned off.
# MAPS_PROVIDER: locationiq | geoapify (default: locationiq when its key is set).
MAPS_PROVIDER = env('MAPS_PROVIDER', default='')
LOCATIONIQ_API_KEY = env('LOCATIONIQ_API_KEY', default='')
GEOAPIFY_API_KEY = env('GEOAPIFY_API_KEY', default='')
# A preventive-maintenance schedule is "due soon" within this many days / km of its due point.
MAINTENANCE_DUE_SOON_DAYS = env.int('MAINTENANCE_DUE_SOON_DAYS', default=30)
MAINTENANCE_DUE_SOON_KM = env.int('MAINTENANCE_DUE_SOON_KM', default=500)
# Document expiry alert thresholds in days (60, 30, 15 and 7 days before; 'expired' is always on).
DOCUMENT_ALERT_DAYS = sorted(env.list('DOCUMENT_ALERT_DAYS', cast=int, default=[60, 30, 15, 7]), reverse=True)

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# --- Auth: Django session in an HttpOnly cookie + CSRF token for the SPA ---
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_AGE = env.int('SESSION_COOKIE_AGE', default=8 * 60 * 60)
# SECURE_COOKIES=False only for a plain-HTTP deployment (no HTTPS on the domain); browsers drop secure cookies over HTTP.
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = env.bool('SECURE_COOKIES', default=not DEBUG)
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_HTTPONLY = False  # the SPA reads csrftoken and sends it as X-CSRFToken; the session cookie stays HttpOnly

# Production serves the SPA and the API from one origin, so no cross-origin access is needed; never a wildcard.
CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=['http://localhost:5173'] if DEBUG else [])
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=['http://localhost:5173'])
# Where the React app is served; used for links built on the server (e.g. TV display links in the admin).
FRONTEND_URL = env('FRONTEND_URL', default='http://localhost:5173').rstrip('/')

# Security headers (SecurityMiddleware / XFrameOptionsMiddleware). The SPA's own headers come from Nginx.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
if not DEBUG:
    SECURE_SSL_REDIRECT = env.bool('SECURE_SSL_REDIRECT', default=True)
    SECURE_REDIRECT_EXEMPT = [r'^api/health/$']  # the container healthcheck calls gunicorn over plain HTTP
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')  # Nginx must set it (and strip a client's own)
    SECURE_HSTS_SECONDS = env.int('SECURE_HSTS_SECONDS', default=31536000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool('SECURE_HSTS_INCLUDE_SUBDOMAINS', default=False)

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['accounts.permissions.SessionAuth'],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
        'accounts.permissions.PasswordChangeNotRequired',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'config.pagination.Pagination',
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    # login: per client IP; login_user: per username tried, so spreading guesses over many IPs doesn't help;
    # password: change-password attempts per user; export: report / workbook downloads per user.
    'DEFAULT_THROTTLE_RATES': {'login': '10/min', 'login_user': '20/hour', 'password': '10/hour',
                               'export': '30/min', 'display': '120/min', 'maps': '120/min'},
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'DOLE VRS API',
    'DESCRIPTION': 'DOLE Vehicle Records System',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'SERVE_PERMISSIONS': ['rest_framework.permissions.IsAuthenticated'],  # the endpoint map is not public
}

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {'std': {'format': '{asctime} {levelname} {name}: {message}', 'style': '{'}},
    'filters': {'redact': {'()': 'config.log_filters.RedactSecrets'}},
    'handlers': {'console': {'class': 'logging.StreamHandler', 'formatter': 'std', 'filters': ['redact']}},
    'root': {'handlers': ['console'], 'level': env('LOG_LEVEL', default='INFO')},
}
