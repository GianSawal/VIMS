import pytest
from django.core.cache import cache
from rest_framework.test import APIClient


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    cache.clear()  # throttle counters must not leak from one test into the next


@pytest.fixture
def api():
    return APIClient(enforce_csrf_checks=True)
