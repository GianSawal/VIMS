# Security

What the system enforces, how production must be configured, and the checks to repeat before each production
release. Tests: `backend/config/test_security.py` (plus the per-module permission tests).

## Before every production release

1. `DATABASE_URL=sqlite:///test.sqlite3 python -m pytest -q` passes (includes the endpoint-wide permission tests).
2. In the backend container: `python manage.py check --deploy`. The only `security.*` warnings allowed are W005
   (HSTS subdomains) and W021 (HSTS preload), both off on purpose (below). The `drf_spectacular` warnings are about
   the API docs only.
3. `pip-audit -r backend/requirements.txt` and `npm audit` (in `frontend/`) report nothing unfixed.
4. `git log --all --name-only --pretty=format: | sort -u` lists no `.env`, database, `media/`, `DATA/` or
   `import_runs/` file (see "Secrets" for the one known exception).

## Production configuration

Set in Coolify's environment variables (never in git). `docker-compose.yaml` already sets the rest.

| Variable | Value |
|---|---|
| `SECRET_KEY` | 50+ random characters: `python -c "import secrets; print(secrets.token_urlsafe(64))"`. The app refuses to start with `DEBUG=False` and a short or placeholder key. |
| `DATABASE_URL` | the least-privilege account below, not the MySQL root user |
| `ALLOWED_HOSTS` | the domain only, e.g. `vrs.example.gov.ph` |
| `CSRF_TRUSTED_ORIGINS` | `https://vrs.example.gov.ph` (also used as the CORS allowlist; the app is one origin, so nothing else is needed) |

Fixed by the compose file / settings:

- `DEBUG=False`. Django's error pages and the dev media server are off; errors go to the log.
- **HTTPS:** Coolify's proxy terminates TLS. Django redirects HTTP to HTTPS (`SECURE_SSL_REDIRECT`), trusts
  `X-Forwarded-Proto` from nginx, and sends HSTS for one year (`SECURE_HSTS_SECONDS`). Subdomains and preload are
  left off because other DOLE sites may share the parent domain; turn on `SECURE_HSTS_INCLUDE_SUBDOMAINS` only if
  every subdomain is HTTPS. A plain-HTTP trial deployment needs `SECURE_SSL_REDIRECT=False` and `SECURE_COOKIES=False`.
- **Cookies:** session cookie `HttpOnly`, `Secure`, `SameSite=Lax`, 8 hours (`SESSION_COOKIE_AGE`). The CSRF cookie
  is `Secure` and `SameSite=Lax` but readable by the page, because the SPA sends it back as `X-CSRFToken`.
- **CSRF:** every write needs the token (DRF session auth), and `CSRF_TRUSTED_ORIGINS` limits the allowed origin.
- **CORS:** no wildcard; the allowlist is the app's own origin (empty by default when `DEBUG=False`).
- **Headers:** Django sends `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `Cross-Origin-Opener-Policy: same-origin` and HSTS. Nginx adds the same plus a Content-Security-Policy and
  Permissions-Policy to the React app (`frontend/security-headers.conf`). The CSP allows scripts only from the app,
  tiles from openstreetmap.org and the Inter font from Google Fonts; add any new external source there.
- **API docs** (`/api/docs/`, `/api/schema/`) need a login.

## Access control

- Every endpoint needs a login except `GET /api/auth/csrf/`, `POST /api/auth/login/` and the TV board
  `GET /api/display/trips/?token=` (random 64-character token, revocable in Django admin, display-safe fields only).
- Permissions are checked on the server for every request (Django model permissions per role; custom actions use
  `require(...)`). The React UI only hides buttons. `test_security.py` walks every endpoint in the OpenAPI schema:
  - logged out = 401;
  - a user without a role is refused everywhere except their own session, password and notifications;
  - a Viewer cannot write anything;
  - users who must change their password are blocked until they do;
  - DELETE exists only for photos and attachment files.
- **Office scoping:** a Field Office User of one office gets 404 for every record, action and file of another office
  (penetration test in `test_security.py`, which also fails if a new office-scoped endpoint has no test record).
  Object lookups run before input validation, so a 400 never confirms that another office's record exists.
- Audit log: System Administrator only, append-only (see `CLAUDE.md`).

## Uploaded files

- Accepted: PDF, JPEG, PNG and WebP only. The content is checked (PDF header, Pillow decode, and the image type must
  match the extension), not just the name. Size limits are `ATTACHMENT_MAX_BYTES` (10 MB) and
  `VEHICLE_PHOTO_MAX_BYTES` (5 MB), with nginx `client_max_body_size 15m` as the outer limit.
- Stored under random names (`safe_upload_to`); the client's file name is kept only as display text.
- **Served through Django** (`config/media.py`), in every environment:
  - vehicle and driver photos are public (the logged-out TV board shows them);
  - documents and attachments need a login, the record's view permission and its office;
  - files no record points at are never served.
  In production Django answers with `X-Accel-Redirect: /protected-media/...` and nginx sends the file from its
  `internal` location, so a file URL alone gives nothing.

## Rate limits

| Endpoint | Limit |
|---|---|
| `POST /api/auth/login/` | 10/min per IP, and 20 failed attempts per hour per username from any IP (a correct password resets it; while blocked, even the right password waits) |
| `POST /api/auth/change-password/` | 10/hour per user |
| Report exports (`?export=`), `/api/export/vehicle-record/` | 30/min per user (previews are not limited) |
| `/api/display/trips/`, `/api/maps/*` | 120/min |

The counters live in the cache. Production uses the database cache (`CACHE_URL=dbcache://vrs_cache`, table created
on start) so all gunicorn workers share one count. The Django admin login (`/admin/`) is not rate-limited by these
rules; only System Administrators should have staff accounts.

## Secrets

- `.env` files are git-ignored; only `.env.example` files with placeholders are committed. The map API keys stay on the
  server (`/api/maps/*` proxies them).
- No third-party passwords are stored: `RFIDAccount` has no password field, and the importer never reads the old
  workbook's USERNAME / PW columns.
- **Known exception, action needed:** `DATA/VEHICLE RECORD.xlsx` was committed by mistake in `54283df` and removed in
  `732f354`. The file is gone from the current tree, but it is still in the git history on GitHub. Its RO3 sheet has
  13 filled USERNAME / PW cells (the Easytrip logins). Do this:
  1. **Change those Easytrip passwords.** This is required, because anyone who cloned the repository already has the
     history.
  2. Optionally purge the file from the history (`git filter-repo --path "DATA/VEHICLE RECORD.xlsx" --invert-paths`,
     then force-push every branch). Everyone with a clone has to re-clone afterwards, so agree on it with the team first.

## Logging

- The console log (gunicorn → Coolify) passes through `config.log_filters.RedactSecrets`, which blanks `key=`,
  `token=`, `password=`, session/CSRF cookies and `Authorization` values in messages and tracebacks.
- Login and change-password are marked `sensitive_post_parameters`, so error reports never include the passwords.
- The audit trail stores no passwords (failed logins keep only the username, at most 150 characters) and masks RFID
  account numbers.
- The gunicorn access log has the request path and query string. Only the TV board puts a token in a URL; anyone who
  can read the server logs can already reach the board.

## Database account (least privilege)

The app needs data access plus the schema rights its migrations use on every start. Use a dedicated user limited to
the `vims` database and to the backend's network. Never use root, and never use `GRANT ALL ON *.*`:

```sql
CREATE USER 'vrs_app'@'10.%' IDENTIFIED BY '<long random password>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON vims.* TO 'vrs_app'@'10.%';
```

`DROP` is only needed for migrations that remove a table. A stricter setup uses a second account with the schema
rights for `migrate` only, and gives the running app just `SELECT, INSERT, UPDATE, DELETE`. That needs the `migrate`
step moved out of the container start command.

## Backups

- Back up the MySQL database and the `media` volume together, daily, keeping at least 30 days. Use
  `mysqldump --single-transaction --routines vims`, plus a tar of the volume.
- **Encrypt the backups at rest**, for example `gpg --symmetric --cipher-algo AES256` or an encrypted backup target.
  Keep the passphrase outside the server, with the System Administrator. The backups contain personal data (drivers,
  license scans) and the audit trail.
- Store the backups off the application server, readable only by the backup operator and the System Administrator.
  Don't download them to personal machines.
- Test a restore on staging at least once per quarter: restore the dump and the media, run `migrate`, then open a few
  vehicles, documents and attachments.

## Dependency review

Last run 2026-10-28:
- `pip-audit` (installed environment and `requirements.txt`): no known vulnerabilities.
- `npm audit`: one high-severity advisory in `zod` (GHSA-mrhx-c7xc-m3w5), fixed by upgrading to 4.6.7. Now 0.

Repeat before each release (step 3 at the top).
