"""Production smoke test for DOLE VRS. Read-only: it logs in, reads pages, lists, reports and files, and logs out.

    python deploy/smoke_test.py https://vrs.example.gov.ph --user admin [--viewer viewer1]

Standard library only, so it runs from any machine with Python 3.10+. Passwords are asked for (or read from
VRS_SMOKE_PASSWORD / VRS_SMOKE_VIEWER_PASSWORD) and never printed. The run leaves login, logout and export entries in
the audit trail, which is expected. Exit code 0 = every check passed.
"""
import argparse
import getpass
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

LISTS = ['vehicles', 'drivers', 'documents', 'trips', 'fuel-records', 'rfid-accounts', 'toll-transactions',
         'maintenance', 'maintenance-schedules', 'notifications', 'offices', 'users', 'audit-logs']
EXPORTS = {'csv': b'', 'xlsx': b'PK', 'pdf': b'%PDF'}  # format -> first bytes of a real file
failures = []


def check(ok, label, detail=''):
    print(f'  {"PASS" if ok else "FAIL"}  {label}{f"  ({detail})" if detail and not ok else ""}')
    if not ok:
        failures.append(label)
    return ok


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # report 301/302 as they are instead of following them


class Session:
    def __init__(self, base):
        self.base, self.jar = base, http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), NoRedirect)

    def request(self, method, path, body=None):
        url = path if path.startswith('http') else self.base + path
        page = not urllib.parse.urlsplit(url).path.startswith('/api/') or url.endswith('/api/docs/')
        headers = {'Accept': 'text/html,*/*' if page else 'application/json', 'Origin': self.base, 'Referer': self.base + '/'}
        token = next((c.value for c in self.jar if c.name == 'csrftoken'), None)
        if token:
            headers['X-CSRFToken'] = token
        data = None
        if body is not None:
            data, headers['Content-Type'] = json.dumps(body).encode(), 'application/json'
        try:
            with self.opener.open(urllib.request.Request(url, data, headers, method=method), timeout=60) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def get(self, path):
        return self.request('GET', path)

    def json(self, path):
        code, _, body = self.get(path)
        return code, (json.loads(body) if code == 200 and body else None)

    def login(self, username, password):
        self.get('/api/auth/csrf/')
        code, _, body = self.request('POST', '/api/auth/login/', {'username': username, 'password': password})
        return code


def password_for(env_name, username):
    return os.environ.get(env_name) or getpass.getpass(f'Password for {username}: ')


def public_checks(base):
    s = Session(base)
    print('Public')
    code, _, body = s.get('/api/health/')
    check(code == 200 and b'"ok"' in body, 'GET /api/health/ answers ok', f'HTTP {code}')
    code, headers, body = s.get('/')
    check(code == 200 and b'id="root"' in body, 'React app loads', f'HTTP {code}')
    check('frame-ancestors' in (headers.get('Content-Security-Policy') or ''), 'Content-Security-Policy on the app')
    check(headers.get('X-Frame-Options') == 'DENY', 'X-Frame-Options: DENY on the app')
    code, _, _ = s.get('/vehicles')
    check(code == 200, 'Client-side route (/vehicles) serves the app', f'HTTP {code}')
    code, headers, _ = s.get('/api/vehicles/')
    check(code == 401, 'Logged-out API call is refused (401)', f'HTTP {code}')
    if base.startswith('https://'):
        check('max-age' in (headers.get('Strict-Transport-Security') or ''), 'HSTS header on API responses')
        code, headers, _ = s.get('http://' + base[len('https://'):] + '/')
        check(code in (301, 302, 307, 308) and (headers.get('Location') or '').startswith('https://'),
              'Plain HTTP redirects to HTTPS', f'HTTP {code}')
    code, _, _ = s.get('/api/docs/')
    check(code in (401, 403), 'API docs need a login', f'HTTP {code}')
    code, _, _ = s.get('/admin/login/')
    check(code == 200, 'Django admin login page loads', f'HTTP {code}')


def admin_checks(base, username, password):
    s = Session(base)
    print(f'Signed in as {username}')
    code = s.login(username, password)
    if not check(code == 200, 'Login', f'HTTP {code}'):
        return
    code, me = s.json('/api/auth/me/')
    check(code == 200, '/api/auth/me/', f'HTTP {code}')
    if me and me.get('must_change_password'):
        check(False, 'Account is ready', 'must change its password first: sign in on the website and change it')
        return
    check(me and me.get('role') == 'System Administrator', 'Role is System Administrator', me and me.get('role'))

    for name in LISTS:
        code, _, _ = s.get(f'/api/{name}/')
        check(code == 200, f'List /api/{name}/', f'HTTP {code}')
    code, _, _ = s.get('/api/dashboard/')
    check(code == 200, 'Dashboard', f'HTTP {code}')
    code, _, _ = s.get('/api/maps/status/')
    check(code == 200, 'Maps status', f'HTTP {code}')

    code, reports = s.json('/api/reports/')
    check(code == 200 and reports, 'Report catalogue', f'HTTP {code}')
    if reports:
        slug = 'vehicle-master-list' if any(r['slug'] == 'vehicle-master-list' for r in reports) else reports[0]['slug']
        code, _, _ = s.get(f'/api/reports/{slug}/')
        check(code == 200, f'Report preview {slug}', f'HTTP {code}')
        for fmt, magic in EXPORTS.items():
            code, _, body = s.get(f'/api/reports/{slug}/?export={fmt}')
            check(code == 200 and body.startswith(magic) and len(body) > 50, f'Report export {fmt.upper()}',
                  f'HTTP {code}, {len(body)} bytes')

    files_checks(base, s)
    code, _, _ = s.request('POST', '/api/auth/logout/', {})
    check(code in (200, 204), 'Logout', f'HTTP {code}')
    code, _, _ = s.get('/api/vehicles/')
    check(code == 401, 'Session ends at logout', f'HTTP {code}')


def files_checks(base, s):
    """An existing vehicle photo and document file are served, and the document is refused without a login."""
    _, vehicles = s.json('/api/vehicles/?page_size=100')
    photo = next((v['photo_url'] for v in (vehicles or {}).get('results', []) if v.get('photo_url')), None)
    if photo:
        code, _, body = s.get(photo)
        check(code == 200 and len(body) > 0, 'Vehicle photo is served (media volume + nginx)', f'HTTP {code}')
    else:
        print('  SKIP  Vehicle photo (no vehicle has one yet)')
    _, documents = s.json('/api/documents/?page_size=100')
    doc = next((d['file'] for d in (documents or {}).get('results', []) if d.get('file')), None)
    if doc:
        path = urllib.parse.urlsplit(doc).path
        code, headers, body = s.get(path)
        check(code == 200 and len(body) > 0 and 'no-store' in (headers.get('Cache-Control') or ''),
              'Document file is served to its office', f'HTTP {code}')
        code, _, _ = Session(base).get(path)
        check(code in (401, 403, 404), 'Document file is refused without a login', f'HTTP {code}')
    else:
        print('  SKIP  Document file (no document has a file yet)')


def viewer_checks(base, username, password):
    s = Session(base)
    print(f'Signed in as {username} (expected: a role without write access, e.g. Viewer)')
    code = s.login(username, password)
    if not check(code == 200, 'Login', f'HTTP {code}'):
        return
    code, _, _ = s.get('/api/vehicles/')
    check(code == 200, 'Can read vehicles', f'HTTP {code}')
    code, _, _ = s.request('POST', '/api/vehicles/', {})
    check(code == 403, 'Cannot create a vehicle (403)', f'HTTP {code}')
    code, _, _ = s.get('/api/audit-logs/')
    check(code == 403, 'Cannot read the audit trail (403)', f'HTTP {code}')
    code, _, _ = s.get('/api/users/')
    check(code == 403, 'Cannot manage users (403)', f'HTTP {code}')
    s.request('POST', '/api/auth/logout/', {})


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('base_url', help='e.g. https://vrs.example.gov.ph')
    p.add_argument('--user', help='a System Administrator account (skips the signed-in checks if left out)')
    p.add_argument('--viewer', help='an account without write access, to confirm writes are refused')
    args = p.parse_args()
    base = args.base_url.rstrip('/')

    public_checks(base)
    if args.user:
        admin_checks(base, args.user, password_for('VRS_SMOKE_PASSWORD', args.user))
    if args.viewer:
        viewer_checks(base, args.viewer, password_for('VRS_SMOKE_VIEWER_PASSWORD', args.viewer))
    print(f'\n{"All checks passed." if not failures else f"{len(failures)} check(s) failed: " + "; ".join(failures)}')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
