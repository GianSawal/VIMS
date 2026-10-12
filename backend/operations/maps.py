"""
Place search and driving routes on OpenStreetMap data, server side only: keys stay in backend/.env and never
reach the browser.

Providers (MAPS_PROVIDER in .env):
- locationiq (default when LOCATIONIQ_API_KEY is set): finds more Philippine government offices.
- geoapify:   GEOAPIFY_API_KEY.

Both expose the same two functions:
- autocomplete(text) -> [{place_id, main, secondary, lat, lon}]   (Philippines only)
- route(origin, destination) -> {distance_km, duration_min, origin, destination, geometry}
  origin/destination: {lat, lon} or {address} (typed places are geocoded first).
Standard-library HTTP client; no extra dependency.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

TIMEOUT = 8             # seconds; the form keeps working if the service is slow
MAX_ROUTE_POINTS = 400  # route line is thinned to this many points before it is sent/stored


class MapsError(Exception):
    """A message that is safe to show to the user."""


class NotFound(Exception):
    """The provider answered 'nothing found' (LocationIQ uses HTTP 404 for that)."""


def provider():
    chosen = (settings.MAPS_PROVIDER or '').lower()
    if chosen in ('locationiq', 'geoapify'):
        return chosen
    return 'locationiq' if settings.LOCATIONIQ_API_KEY else 'geoapify'


def _key():
    return settings.LOCATIONIQ_API_KEY if provider() == 'locationiq' else settings.GEOAPIFY_API_KEY


def enabled():
    return bool(_key())


def _get(url, **params):
    url = f'{url}?{urllib.parse.urlencode(params, safe=",|:;")}'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/json'}), timeout=TIMEOUT) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise NotFound() from e
        if e.code == 429:
            raise MapsError('The map service is busy (too many requests). Wait a moment and try again.') from e
        raise MapsError(f'The map service refused the request ({e.code}). Check the map API key.') from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise MapsError('The map service could not be reached. Type the place manually and try again later.') from e


def _thin(coords, limit=MAX_ROUTE_POINTS):
    """Keep every n-th point (always the last) so a long route stays small enough to store and draw."""
    if len(coords) <= limit:
        return coords
    step = len(coords) / (limit - 1)
    return [coords[int(i * step)] for i in range(limit - 1)] + [coords[-1]]


def _result(distance_m, seconds, a, b, lonlat_lines):
    coords = [[round(lat, 5), round(lon, 5)] for line in lonlat_lines for lon, lat in line]  # GeoJSON is [lon, lat]
    return {
        'distance_km': round(distance_m / 1000, 1),
        'duration_min': round(seconds / 60),
        'origin': [round(a[0], 6), round(a[1], 6)],
        'destination': [round(b[0], 6), round(b[1], 6)],
        'geometry': _thin(coords),
    }


# ---------------------------------------------------------------- LocationIQ

LIQ = 'https://api.locationiq.com/v1'
LIQ_ROUTE = 'https://us1.locationiq.com/v1/directions/driving'


def _liq_autocomplete(text):
    try:
        rows = _get(f'{LIQ}/autocomplete', key=_key(), q=text, countrycodes='ph', limit=6, dedupe=1, **{'accept-language': 'en'})
    except NotFound:
        return []
    return [{'place_id': str(r.get('place_id', '')), 'main': r.get('display_place') or r.get('display_name', ''),
             'secondary': r.get('display_address', ''), 'lat': float(r['lat']), 'lon': float(r['lon'])}
            for r in rows if 'lat' in r and 'lon' in r]


def _liq_geocode(address):
    try:
        rows = _get(f'{LIQ}/search', key=_key(), q=address, countrycodes='ph', format='json', limit=1)
    except NotFound:
        rows = []
    if not rows:
        raise MapsError(f'Could not find "{address}" on the map. Pick a suggestion instead.')
    return float(rows[0]['lat']), float(rows[0]['lon'])


def _liq_route(a, b):
    try:
        data = _get(f'{LIQ_ROUTE}/{a[1]},{a[0]};{b[1]},{b[0]}', key=_key(), overview='full', geometries='geojson', steps='false')
    except NotFound:
        data = {}
    routes = data.get('routes') or []
    if not routes:
        raise MapsError('No driving route was found between these places.')
    r = routes[0]
    return _result(r['distance'], r['duration'], a, b, [r['geometry']['coordinates']])


# ---------------------------------------------------------------- Geoapify

GEO = 'https://api.geoapify.com/v1'


def _geo_autocomplete(text):
    data = _get(f'{GEO}/geocode/autocomplete', apiKey=_key(), text=text, filter='countrycode:ph', format='json', limit=6, lang='en')
    return [{'place_id': r.get('place_id', ''), 'main': r.get('address_line1') or r.get('name') or r.get('formatted', ''),
             'secondary': r.get('address_line2', ''), 'lat': r['lat'], 'lon': r['lon']}
            for r in data.get('results', []) if 'lat' in r and 'lon' in r]


def _geo_geocode(address):
    results = _get(f'{GEO}/geocode/search', apiKey=_key(), text=address, filter='countrycode:ph', format='json', limit=1).get('results') or []
    if not results:
        raise MapsError(f'Could not find "{address}" on the map. Pick a suggestion instead.')
    return results[0]['lat'], results[0]['lon']


def _geo_route(a, b):
    features = _get(f'{GEO}/routing', apiKey=_key(), waypoints=f'{a[0]},{a[1]}|{b[0]},{b[1]}', mode='drive').get('features') or []
    if not features:
        raise MapsError('No driving route was found between these places.')
    props, geom = features[0]['properties'], features[0]['geometry']
    lines = geom['coordinates'] if geom['type'] == 'MultiLineString' else [geom['coordinates']]
    return _result(props['distance'], props['time'], a, b, lines)


# ---------------------------------------------------------------- public API

def autocomplete(text):
    return _liq_autocomplete(text) if provider() == 'locationiq' else _geo_autocomplete(text)


def _locate(point):
    if point.get('lat') is not None and point.get('lon') is not None:
        return float(point['lat']), float(point['lon'])
    return _liq_geocode(point['address']) if provider() == 'locationiq' else _geo_geocode(point['address'])


def route(origin, destination):
    a, b = _locate(origin), _locate(destination)
    return _liq_route(a, b) if provider() == 'locationiq' else _geo_route(a, b)
