"""
Geoapify (OpenStreetMap data), server side only: the key stays in backend/.env and never reaches the browser.

- autocomplete(): Geocoding API  /v1/geocode/autocomplete, limited to the Philippines.
- route():        Routing API    /v1/routing (mode=drive): distance, time and the route line.

Places without coordinates (typed, not picked) are geocoded first with /v1/geocode/search.
Standard-library HTTP client; no extra dependency.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

BASE = 'https://api.geoapify.com/v1'
TIMEOUT = 8          # seconds; the form keeps working if the service is slow
MAX_ROUTE_POINTS = 400  # route line is thinned to this many points before it is sent/stored


class MapsError(Exception):
    """A message that is safe to show to the user."""


def enabled():
    return bool(settings.GEOAPIFY_API_KEY)


def _get(path, **params):
    params['apiKey'] = settings.GEOAPIFY_API_KEY
    url = f'{BASE}/{path}?{urllib.parse.urlencode(params, safe=",|:")}'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/json'}), timeout=TIMEOUT) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        raise MapsError(f'The map service refused the request ({e.code}). Check the Geoapify API key.') from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise MapsError('The map service could not be reached. Type the place manually and try again later.') from e


def autocomplete(text):
    """Place suggestions: [{place_id, main, secondary, lat, lon}]."""
    data = _get('geocode/autocomplete', text=text, filter='countrycode:ph', format='json', limit=6, lang='en')
    return [{
        'place_id': r.get('place_id', ''),
        'main': r.get('address_line1') or r.get('name') or r.get('formatted', ''),
        'secondary': r.get('address_line2', ''),
        'lat': r['lat'], 'lon': r['lon'],
    } for r in data.get('results', []) if 'lat' in r and 'lon' in r]


def _locate(point):
    """{lat, lon} as given, or geocode the typed address."""
    if point.get('lat') is not None and point.get('lon') is not None:
        return float(point['lat']), float(point['lon'])
    data = _get('geocode/search', text=point['address'], filter='countrycode:ph', format='json', limit=1)
    results = data.get('results') or []
    if not results:
        raise MapsError(f'Could not find "{point["address"]}" on the map. Pick a suggestion instead.')
    return results[0]['lat'], results[0]['lon']


def _thin(coords, limit=MAX_ROUTE_POINTS):
    """Keep every n-th point (always the last) so a long route stays small enough to store and draw."""
    if len(coords) <= limit:
        return coords
    step = len(coords) / (limit - 1)
    return [coords[int(i * step)] for i in range(limit - 1)] + [coords[-1]]


def route(origin, destination):
    """
    One-way driving route. origin/destination: {lat, lon} or {address}.
    Returns {distance_km, duration_min, origin: [lat, lon], destination: [lat, lon], geometry: [[lat, lon], ...]}.
    """
    a, b = _locate(origin), _locate(destination)
    data = _get('routing', waypoints=f'{a[0]},{a[1]}|{b[0]},{b[1]}', mode='drive')
    features = data.get('features') or []
    if not features:
        raise MapsError('No driving route was found between these places.')
    props, geom = features[0]['properties'], features[0]['geometry']
    lines = geom['coordinates'] if geom['type'] == 'MultiLineString' else [geom['coordinates']]
    coords = [[round(lat, 5), round(lon, 5)] for line in lines for lon, lat in line]  # GeoJSON is [lon, lat]
    return {
        'distance_km': round(props['distance'] / 1000, 1),
        'duration_min': round(props['time'] / 60),
        'origin': [round(a[0], 6), round(a[1], 6)],
        'destination': [round(b[0], 6), round(b[1], 6)],
        'geometry': _thin(coords),
    }
