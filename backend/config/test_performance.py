"""Phase 17 performance: every list, summary, dashboard and report endpoint runs a fixed number of SQL queries,
however many records there are (no N+1). Measured on seed_demo data, then again after adding more offices'
worth of vehicles, drivers, fuel, trips, maintenance and tolls."""
import io
import random

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APIClient

from accounts.models import Office, User
from accounts.permissions import scope_to_offices
from dataimport.management.commands.seed_demo import Command as SeedDemo
from fleet.models import Driver, Vehicle
from reports.catalog import REPORTS

pytestmark = pytest.mark.django_db
# Reports that need a vehicle or driver are measured with the first one.
NEEDS = {'vehicle-history': 'vehicle', 'driver-assignment': 'driver'}


def get_endpoints():
    schema = SchemaGenerator().get_schema(request=None, public=True)
    plain = [p for p, ops in schema['paths'].items() if 'get' in ops and '{' not in p
             and not p.startswith(('/api/auth/', '/api/display/', '/api/maps/', '/api/import/', '/api/export/'))]
    return plain + [f'/api/reports/{slug}/' for slug in REPORTS]


def measure(client, urls, params):
    out = {}
    for url in urls:
        slug = url.rstrip('/').rsplit('/', 1)[-1]
        query = {NEEDS[slug]: params[NEEDS[slug]]} if slug in NEEDS else {}
        with CaptureQueriesContext(connection) as ctx:
            r = client.get(url, query)
        if r.status_code == 403:  # not this role's module (e.g. audit log for a Field Office User)
            continue
        assert r.status_code == 200, (url, r.status_code, query, r.content[:300])
        out[url] = len(ctx)
    return out


def add_more(codes, scale):
    """More offices of demo data (codes start with X so unique numbers never clash with the first run)."""
    seed = SeedDemo()
    seed.rng, seed.today = random.Random(sum(map(ord, ''.join(codes)))), timezone.localdate()
    offices = {c: Office.objects.create(code=c, name=f'Extra Office {c}', office_type='FIELD') for c in codes}
    seed.fleet(offices, User.objects.get(username='qa_fleetadmin'), scale, 3)
    return offices.values()


@pytest.mark.parametrize('username', ['qa_sysadmin', 'qa_field'])
def test_query_count_does_not_grow_with_data(settings, tmp_path, username):
    settings.MEDIA_ROOT = tmp_path
    call_command('seed_demo', scale=2, months=3, accounts_file=tmp_path / 'accounts.txt', stdout=io.StringIO())
    user = User.objects.get(username=username)
    c = APIClient()
    c.force_authenticate(user)
    grow = lambda codes, scale: user.offices.add(*add_more(codes, scale)) if username == 'qa_field' else add_more(codes, scale)
    # Two non-empty runs (so prefetches that only run when there are rows are already counted), the second with
    # about three times the records.
    grow(['X1'], 3)
    params = {'vehicle': scope_to_offices(Vehicle.objects.all(), user, 'office').first().pk,
              'driver': scope_to_offices(Driver.objects.all(), user, 'office').first().pk}
    urls = get_endpoints()
    measure(c, urls, params)  # warm caches (content types, permissions)
    before = measure(c, urls, params)

    grow(['X2', 'X3'], 6)
    after = measure(c, urls, params)

    grew = {u: (before[u], after[u]) for u in before if after[u] > before[u]}
    assert not grew, f'queries grow with the data (before, after): {grew}'
    # A fixed ceiling too, which catches per-row lookups on pages whose row count didn't change (notifications).
    assert max(after.values()) <= 25, sorted(after.items(), key=lambda x: -x[1])[:5]
