"""Google Maps proxy: place search + driving distance (Google mocked), and the estimate saved on trips."""
import io
import json
import urllib.error
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Office
from fleet.test_drivers import make_driver
from fleet.test_vehicles import as_role, make_vehicle
from operations import maps

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def seed(settings):
    settings.GOOGLE_MAPS_API_KEY = 'test-key'
    call_command('seed_reference', stdout=io.StringIO())


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def google(monkeypatch):
    """Records what we send to Google and answers like the real APIs."""
    calls = []

    def fake_urlopen(req, timeout):
        body = json.loads(req.data)
        calls.append({'url': req.full_url, 'body': body, 'headers': dict(req.header_items())})
        if 'autocomplete' in req.full_url:
            return FakeResponse(json.dumps({'suggestions': [
                {'placePrediction': {'placeId': 'P1', 'structuredFormat': {
                    'mainText': {'text': 'Luxent Hotel'}, 'secondaryText': {'text': 'Timog Ave, Quezon City'}}}},
                {'queryPrediction': {'text': {'text': 'luxent'}}},  # non-place suggestions are skipped
            ]}).encode())
        return FakeResponse(json.dumps({'routes': [{'distanceMeters': 128449, 'duration': '9300s'}]}).encode())

    monkeypatch.setattr(maps.urllib.request, 'urlopen', fake_urlopen)
    return calls


def test_autocomplete_proxies_with_server_key_and_ph_only(google):
    c = as_role('Field Office User')
    r = c.get('/api/maps/autocomplete/', {'q': 'luxent', 'session': 'abc'})
    assert r.status_code == 200
    assert r.json() == {'results': [{'place_id': 'P1', 'main': 'Luxent Hotel', 'secondary': 'Timog Ave, Quezon City'}]}
    sent = google[0]
    assert sent['body']['includedRegionCodes'] == ['ph'] and sent['body']['sessionToken'] == 'abc'
    assert sent['headers']['X-goog-api-key'] == 'test-key'
    assert 'test-key' not in r.content.decode()  # the key never reaches the browser


def test_short_queries_skip_google(google):
    assert as_role('Fleet Administrator').get('/api/maps/autocomplete/', {'q': 'lu'}).json() == {'results': []}
    assert google == []


def test_route_distance_and_time(google):
    c = as_role('Fleet Administrator')
    r = c.post('/api/maps/route/', {'origin': {'address': 'DOLE Regional Office III, San Fernando, Pampanga'},
                                    'destination': {'place_id': 'P1'}}, format='json')
    assert r.status_code == 200 and r.json() == {'distance_km': 128.4, 'duration_min': 155}
    assert google[0]['body']['origin'] == {'address': 'DOLE Regional Office III, San Fernando, Pampanga'}
    assert google[0]['body']['destination'] == {'placeId': 'P1'} and google[0]['body']['travelMode'] == 'DRIVE'
    assert c.post('/api/maps/route/', {'origin': {}, 'destination': {'place_id': 'P1'}}, format='json').status_code == 400


def test_google_failures_become_friendly_errors(monkeypatch):
    def down(req, timeout):
        raise urllib.error.URLError('no network')
    monkeypatch.setattr(maps.urllib.request, 'urlopen', down)
    r = as_role('Fleet Administrator').get('/api/maps/autocomplete/', {'q': 'luxent'})
    assert r.status_code == 502 and 'could not be reached' in r.json()['detail']

    def no_route(req, timeout):
        return FakeResponse(b'{}')
    monkeypatch.setattr(maps.urllib.request, 'urlopen', no_route)
    r = as_role('Fleet Administrator').post('/api/maps/route/', {'origin': {'address': 'a b c'}, 'destination': {'address': 'd e f'}}, format='json')
    assert r.status_code == 502 and 'No driving route' in r.json()['detail']


def test_disabled_without_key_and_needs_trip_permission(settings, google):
    assert as_role('Viewer').get('/api/maps/status/').status_code == 403
    assert as_role('Fleet Administrator').get('/api/maps/status/').json() == {'enabled': True}
    settings.GOOGLE_MAPS_API_KEY = ''
    c = as_role('Fleet Administrator')
    assert c.get('/api/maps/status/').json() == {'enabled': False}
    assert c.get('/api/maps/autocomplete/', {'q': 'luxent'}).status_code == 503
    assert google == []


def test_trip_saves_the_estimate():
    fo = Office.objects.create(code='FO1', name='FO1', office_type='FIELD')
    v, d = make_vehicle(fo, 'MAP 1', current_odometer=1000), make_driver(fo)
    c = as_role('Fleet Administrator')
    r = c.post('/api/trips/', {'vehicle': v.pk, 'driver': d.pk, 'origin': 'RO', 'destination': 'Luxent Hotel',
                               'purpose': 'Meeting', 'departed_at': timezone.now().isoformat(), 'odometer_start': 1000,
                               'estimated_distance_km': '128.4', 'estimated_duration_min': 155}, format='json')
    assert r.status_code == 201 and r.json()['estimated_distance_km'] == '128.4' and r.json()['estimated_duration_min'] == 155
    r = c.post('/api/trips/schedule/', {'vehicle': make_vehicle(fo, 'MAP 2').pk, 'driver': make_driver(fo, 'Juan', 'L-2').pk,
                                        'scheduled_departure': (timezone.now() + timedelta(days=2)).isoformat(),
                                        'origin': 'RO', 'destination': 'Tarlac', 'purpose': 'x', 'estimated_distance_km': '45.0'}, format='json')
    assert r.status_code == 201 and r.json()['estimated_distance_km'] == '45.0'
