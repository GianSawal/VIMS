import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api():
    return APIClient(enforce_csrf_checks=True)
