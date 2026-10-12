"""
Google Maps, server side only: the API key stays in backend/.env and is never sent to the browser.

- autocomplete(): Places API (New)  places:autocomplete, limited to the Philippines.
- route():        Routes API        directions/v2:computeRoutes, driving distance and time.

Uses the standard library HTTP client (no extra dependency). Enable both APIs on the key in Google Cloud and
restrict the key to the server's IP address.
"""
import json
import urllib.error
import urllib.request

from django.conf import settings

AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'
ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
TIMEOUT = 8  # seconds; the form keeps working if Google is slow


class MapsError(Exception):
    """A message that is safe to show to the user."""


def enabled():
    return bool(settings.GOOGLE_MAPS_API_KEY)


def _post(url, body, field_mask):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': settings.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': field_mask,
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        # Google's error body can include request details; log-worthy, not user-worthy.
        raise MapsError(f'Google Maps refused the request ({e.code}). Check that the API key and APIs are enabled.') from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise MapsError('Google Maps could not be reached. Type the place manually and try again later.') from e


def autocomplete(text, session_token=''):
    """Place suggestions for `text`: [{place_id, main, secondary}]."""
    body = {'input': text, 'includedRegionCodes': ['ph'], 'languageCode': 'en'}
    if session_token:
        body['sessionToken'] = session_token  # groups keystrokes + the final pick into one billed session
    data = _post(AUTOCOMPLETE_URL, body, 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat')
    out = []
    for s in data.get('suggestions', []):
        p = s.get('placePrediction')
        if not p:
            continue
        fmt = p.get('structuredFormat', {})
        out.append({'place_id': p['placeId'], 'main': fmt.get('mainText', {}).get('text', ''),
                    'secondary': fmt.get('secondaryText', {}).get('text', '')})
    return out


def _waypoint(w):
    return {'placeId': w['place_id']} if w.get('place_id') else {'address': w['address']}


def route(origin, destination):
    """One-way driving distance and time. origin/destination: {'place_id': ...} or {'address': ...}."""
    data = _post(ROUTES_URL, {
        'origin': _waypoint(origin), 'destination': _waypoint(destination), 'travelMode': 'DRIVE',
        'routingPreference': 'TRAFFIC_UNAWARE', 'regionCode': 'ph', 'units': 'METRIC',
    }, 'routes.distanceMeters,routes.duration')
    routes = data.get('routes') or []
    if not routes or 'distanceMeters' not in routes[0]:
        raise MapsError('No driving route was found between these places.')
    seconds = int(str(routes[0].get('duration', '0s')).rstrip('s') or 0)
    return {'distance_km': round(routes[0]['distanceMeters'] / 1000, 1), 'duration_min': round(seconds / 60)}
