"""Map proxy (Geoapify and LocationIQ, services mocked): place search, driving route, and what trips save."""
import io
import json
import urllib.error
import urllib.parse
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle
from operations import maps
from operations.models import Trip

pytestmark = pytest.mark.django_db

ROUTE = {'features': [{'properties': {'distance': 36660, 'time': 1867.1},
                       'geometry': {'type': 'MultiLineString', 'coordinates': [[[120.689117, 15.032933], [120.6, 15.1], [120.530099, 15.180947]]]}}]}


@pytest.fixture(autouse=True)
def seed(settings):
    settings.MAPS_PROVIDER, settings.GEOAPIFY_API_KEY, settings.LOCATIONIQ_API_KEY = 'geoapify', 'test-key', ''
    call_command('seed_reference', stdout=io.StringIO())


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def geo(monkeypatch):
    """Records the URLs we call and answers like Geoapify."""
    calls = []

    def fake_urlopen(req, timeout):
        url = urllib.parse.urlparse(req.full_url)
        q = dict(urllib.parse.parse_qsl(url.query))
        calls.append({'path': url.path, 'q': q})
        if url.path.endswith('/geocode/autocomplete'):
            return FakeResponse(json.dumps({'results': [
                {'place_id': 'P1', 'address_line1': 'Royce Hotel and Casino', 'address_line2': 'Mabalacat, Pampanga',
                 'lat': 15.1809467, 'lon': 120.5300991},
                {'place_id': 'NOPOS', 'address_line1': 'No coordinates'},  # skipped
            ]}).encode())
        if url.path.endswith('/geocode/search'):
            return FakeResponse(json.dumps({'results': [{'lat': 15.0328, 'lon': 120.689}]}).encode())
        return FakeResponse(json.dumps(ROUTE).encode())

    monkeypatch.setattr(maps.urllib.request, 'urlopen', fake_urlopen)
    return calls


def test_autocomplete_ph_only_with_server_key(geo):
    r = as_role('Field Office User').get('/api/maps/autocomplete/', {'q': 'royce hotel clark'})
    assert r.status_code == 200
    assert r.json() == {'results': [{'place_id': 'P1', 'main': 'Royce Hotel and Casino', 'secondary': 'Mabalacat, Pampanga',
                                     'lat': 15.1809467, 'lon': 120.5300991}]}
    assert geo[0]['q']['filter'] == 'countrycode:ph' and geo[0]['q']['apiKey'] == 'test-key'
    assert 'test-key' not in r.content.decode()  # the key never reaches the browser


def test_short_queries_skip_the_service(geo):
    assert as_role('Fleet Administrator').get('/api/maps/autocomplete/', {'q': 'ro'}).json() == {'results': []}
    assert geo == []


def test_route_from_coordinates(geo):
    r = as_role('Fleet Administrator').post('/api/maps/route/', {
        'origin': {'lat': 15.032933, 'lon': 120.689117}, 'destination': {'lat': 15.1809467, 'lon': 120.5300991}}, format='json')
    assert r.status_code == 200
    body = r.json()
    assert body['distance_km'] == 36.7 and body['duration_min'] == 31
    assert body['geometry'][0] == [15.03293, 120.68912] and len(body['geometry']) == 3  # [lat, lng] for Leaflet
    assert geo[0]['q']['waypoints'] == '15.032933,120.689117|15.1809467,120.5300991' and geo[0]['q']['mode'] == 'drive'


def test_route_geocodes_typed_addresses(geo):
    r = as_role('Fleet Administrator').post('/api/maps/route/', {
        'origin': {'address': 'DOLE Regional Office III, San Fernando'}, 'destination': {'lat': 15.18, 'lon': 120.53}}, format='json')
    assert r.status_code == 200 and r.json()['origin'] == [15.0328, 120.689]
    assert [c['path'].rsplit('/', 1)[-1] for c in geo] == ['search', 'routing']
    assert as_role('Fleet Administrator').post('/api/maps/route/', {'origin': {}, 'destination': {'lat': 1, 'lon': 1}}, format='json').status_code == 400


def test_long_routes_are_thinned():
    coords = [[float(i), 0.0] for i in range(2000)]
    thin = maps._thin(coords)
    assert len(thin) == maps.MAX_ROUTE_POINTS and thin[0] == coords[0] and thin[-1] == coords[-1]


def test_service_failures_become_friendly_errors(monkeypatch):
    def down(req, timeout):
        raise urllib.error.URLError('no network')
    monkeypatch.setattr(maps.urllib.request, 'urlopen', down)
    r = as_role('Fleet Administrator').get('/api/maps/autocomplete/', {'q': 'royce'})
    assert r.status_code == 502 and 'could not be reached' in r.json()['detail']

    def no_route(req, timeout):
        return FakeResponse(b'{"features": []}')
    monkeypatch.setattr(maps.urllib.request, 'urlopen', no_route)
    r = as_role('Fleet Administrator').post('/api/maps/route/', {'origin': {'lat': 1, 'lon': 1}, 'destination': {'lat': 2, 'lon': 2}}, format='json')
    assert r.status_code == 502 and 'No driving route' in r.json()['detail']


def test_disabled_without_key_and_needs_trip_permission(settings, geo):
    assert as_role('Viewer').get('/api/maps/status/').status_code == 403
    assert as_role('Fleet Administrator').get('/api/maps/status/').json() == {'enabled': True, 'provider': 'geoapify', 'providers': ['geoapify']}
    settings.GEOAPIFY_API_KEY = ''
    c = as_role('Fleet Administrator')
    assert c.get('/api/maps/status/').json() == {'enabled': False, 'provider': 'geoapify', 'providers': []}
    assert c.get('/api/maps/autocomplete/', {'q': 'royce'}).status_code == 503
    assert geo == []


def test_trip_saves_locations_route_and_estimate():
    fo = Office.objects.create(code='FO1', name='FO1', office_type='FIELD')
    v, d = make_vehicle(fo, 'MAP 1', current_odometer=1000), make_driver(fo)
    c = as_role('Fleet Administrator')
    line = [[15.032933, 120.689117], [15.1, 120.6], [15.180947, 120.530099]]
    r = c.post('/api/trips/', {'vehicle': v.pk, 'driver': d.pk, 'origin': 'DOLE RO III', 'destination': 'Royce Hotel',
                               'purpose': 'Meeting', 'departed_at': timezone.now().isoformat(), 'odometer_start': 1000,
                               'estimated_distance_km': '36.7', 'estimated_duration_min': 31,
                               'origin_lat': '15.032933', 'origin_lng': '120.689117',
                               'destination_lat': '15.180947', 'destination_lng': '120.530099', 'route_geometry': line}, format='json')
    assert r.status_code == 201, r.json()
    t = Trip.objects.get()
    assert str(t.destination_lat) == '15.180947' and t.route_geometry == line and str(t.estimated_distance_km) == '36.7'
    assert r.json()['route_geometry'] == line
    bad = c.post('/api/trips/schedule/', {'vehicle': make_vehicle(fo, 'MAP 2').pk, 'driver': make_driver(fo, 'Juan', 'L-2').pk,
                                          'scheduled_departure': (timezone.now() + timedelta(days=2)).isoformat(),
                                          'origin': 'a', 'destination': 'b', 'purpose': 'x', 'route_geometry': [['x', 1]]}, format='json')
    assert bad.status_code == 400 and 'route_geometry' in bad.json()
    # editing the destination later can update the saved route too
    r = c.patch(f'/api/trips/{t.pk}/', {'destination': 'Clark', 'route_geometry': line[:2], 'estimated_distance_km': '20.0'}, format='json')
    assert r.status_code == 200 and r.json()['route_geometry'] == line[:2]


def test_tv_display_does_not_expose_coordinates():
    from operations.serializers import DisplayTripSerializer
    assert not {'origin_lat', 'destination_lat', 'route_geometry'} & set(DisplayTripSerializer.Meta.fields)


# ---------------------------------------------------------------- LocationIQ

LIQ_ROUTE = {'routes': [{'distance': 20758.7, 'duration': 1617.8, 'geometry': {
    'type': 'LineString', 'coordinates': [[120.657117, 15.064503], [120.6, 15.1], [120.530099, 15.180947]]}}]}


@pytest.fixture
def liq(settings, monkeypatch):
    settings.MAPS_PROVIDER, settings.LOCATIONIQ_API_KEY = 'locationiq', 'pk.test'
    calls = []

    def fake_urlopen(req, timeout):
        url = urllib.parse.urlparse(req.full_url)
        q = dict(urllib.parse.parse_qsl(url.query))
        calls.append({'path': url.path, 'q': q, 'url': req.full_url})
        if url.path.endswith('/autocomplete'):
            if q['q'].startswith('zzz'):  # LocationIQ answers "nothing found" with HTTP 404
                raise urllib.error.HTTPError(req.full_url, 404, 'Unable to geocode', {}, io.BytesIO(b'{"error":"Unable to geocode"}'))
            return FakeResponse(json.dumps([{'place_id': '331', 'display_place': 'Department of Labor and Employment',
                                             'display_address': 'Diosdado Macapagal Government Center, San Fernando, Pampanga',
                                             'lat': '15.0646288', 'lon': '120.6573293'}]).encode())
        if url.path.endswith('/search'):
            return FakeResponse(json.dumps([{'lat': '15.18', 'lon': '120.53'}]).encode())
        return FakeResponse(json.dumps(LIQ_ROUTE).encode())

    monkeypatch.setattr(maps.urllib.request, 'urlopen', fake_urlopen)
    return calls


def test_locationiq_autocomplete(liq):
    c = as_role('Fleet Administrator')
    r = c.get('/api/maps/autocomplete/', {'q': 'department of labor san fernando'})
    assert r.json()['results'] == [{'place_id': '331', 'main': 'Department of Labor and Employment',
                                    'secondary': 'Diosdado Macapagal Government Center, San Fernando, Pampanga',
                                    'lat': 15.0646288, 'lon': 120.6573293}]
    assert liq[0]['q']['countrycodes'] == 'ph' and liq[0]['q']['key'] == 'pk.test'
    assert c.get('/api/maps/autocomplete/', {'q': 'zzz nowhere'}).json() == {'results': []}  # 404 = empty, not an error
    assert c.get('/api/maps/status/').json() == {'enabled': True, 'provider': 'locationiq', 'providers': ['locationiq', 'geoapify']}


def test_locationiq_route_uses_lon_lat_order_and_geocodes_typed_text(liq):
    r = as_role('Fleet Administrator').post('/api/maps/route/', {
        'origin': {'lat': 15.0646288, 'lon': 120.6573293}, 'destination': {'address': 'Royce Hotel Clark'}}, format='json')
    assert r.status_code == 200
    body = r.json()
    assert body['distance_km'] == 20.8 and body['duration_min'] == 27 and body['destination'] == [15.18, 120.53]
    assert body['geometry'][0] == [15.0645, 120.65712]  # back to [lat, lng] for Leaflet
    route_call = liq[-1]
    assert '/driving/120.6573293,15.0646288;120.53,15.18?' in route_call['url']  # OSRM wants lon,lat
    assert route_call['q']['geometries'] == 'geojson'


def test_provider_defaults_to_locationiq_when_its_key_is_set(settings):
    settings.MAPS_PROVIDER, settings.LOCATIONIQ_API_KEY, settings.GEOAPIFY_API_KEY = '', 'pk.x', 'g'
    assert maps.provider() == 'locationiq'
    settings.LOCATIONIQ_API_KEY = ''
    assert maps.provider() == 'geoapify'


def test_rate_limit_message(liq, monkeypatch):
    def busy(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 429, 'Too Many Requests', {}, io.BytesIO(b''))
    monkeypatch.setattr(maps.urllib.request, 'urlopen', busy)
    r = as_role('Fleet Administrator').get('/api/maps/autocomplete/', {'q': 'royce'})
    assert r.status_code == 502 and 'busy' in r.json()['detail']


def test_falls_back_to_geoapify_when_locationiq_limit_is_used_up(liq, geo, settings, monkeypatch):
    settings.GEOAPIFY_API_KEY = 'test-key'  # both keys set; LocationIQ is the main one
    geoapify = maps.urllib.request.urlopen  # the geo fixture's fake (applied last)

    def liq_over_limit(req, timeout):
        if 'locationiq.com' in req.full_url:
            raise urllib.error.HTTPError(req.full_url, 429, 'Rate Limited Day', {}, io.BytesIO(b''))
        return geoapify(req, timeout)
    monkeypatch.setattr(maps.urllib.request, 'urlopen', liq_over_limit)
    c = as_role('Fleet Administrator')
    assert c.get('/api/maps/status/').json()['providers'] == ['locationiq', 'geoapify']
    r = c.get('/api/maps/autocomplete/', {'q': 'royce hotel'})
    assert r.status_code == 200 and r.json()['results'][0]['place_id'] == 'P1'  # answered by Geoapify
    r = c.post('/api/maps/route/', {'origin': {'lat': 15.03, 'lon': 120.69}, 'destination': {'address': 'Royce'}}, format='json')
    assert r.status_code == 200 and r.json()['distance_km'] == 36.7
    # only LocationIQ configured: its error is shown
    settings.GEOAPIFY_API_KEY = ''
    r = c.get('/api/maps/autocomplete/', {'q': 'royce hotel'})
    assert r.status_code == 502 and 'busy' in r.json()['detail']
