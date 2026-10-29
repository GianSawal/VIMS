# Deployment

How to put DOLE VRS into production on a Linux server with Coolify, and how to check it afterwards. Security settings
and the database account are in [SECURITY.md](SECURITY.md); the spreadsheet import is in [MIGRATION.md](MIGRATION.md).

Work through the sections in order. Each one ends with what to check before moving on.

## 1. Server

- Ubuntu Server 24.04 LTS (or another Linux that Coolify supports), 2 vCPU, 4 GB RAM, 40 GB disk minimum. Uploads
  (license scans, photos, receipts) and the local backups grow the disk; plan 100 GB for several years.
- A public IP (or an internal one, if the system is only used on the DOLE network), ports 80 and 443 open, SSH
  restricted to the administrators. Keep the OS updated (`unattended-upgrades`).
- Install Coolify as root: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`, then open
  `http://<server-ip>:8000`, create the Coolify admin account and turn on two-factor login.
- Set the server time zone to Asia/Manila (`timedatectl set-timezone Asia/Manila`) so cron times read as local time.
  The application itself always uses Asia/Manila.

Check: the Coolify dashboard shows the server as reachable ("localhost" server, green).

## 2. MySQL

Use a Coolify database resource on the same server (or an existing DOLE MySQL 8 server):

1. Coolify → *New resource* → *Database* → **MySQL 8**. Do not make it publicly accessible.
2. In its terminal, create the database and the least-privilege application account (exact grants in
   [SECURITY.md](SECURITY.md#database-account-least-privilege)):
   ```sql
   CREATE DATABASE vims CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'vrs_app'@'%' IDENTIFIED BY '<long random password>';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON vims.* TO 'vrs_app'@'%';
   ```
   `'%'` is acceptable here only because the container is not published outside Coolify's private network.
3. Note the internal host name Coolify shows for the database (a container name), for `DATABASE_URL`.

Check: `mysql -uvrs_app -p vims -e 'SELECT 1'` works from the database terminal.

## 3. Application

1. Coolify → *New resource* → the GitHub repository, branch `main`, build pack **Docker Compose**, file
   `docker-compose.yaml`. It builds two containers: `backend` (Django + gunicorn) and `web` (nginx + the React app).
2. Environment variables (Coolify → *Environment Variables*, never in git):

   | Variable | Value |
   |---|---|
   | `SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_urlsafe(64))"` |
   | `DATABASE_URL` | `mysql://vrs_app:<password>@<mysql internal host>:3306/vims` (URL-encode special characters in the password) |
   | `ALLOWED_HOSTS` | the domain, e.g. `vrs.example.gov.ph`. The first entry must be a real host name: the container healthcheck uses it |
   | `CSRF_TRUSTED_ORIGINS` | `https://vrs.example.gov.ph` |
   | `LOCATIONIQ_API_KEY` / `GEOAPIFY_API_KEY` | optional, for the trip map |

   Everything else (`DEBUG=False`, HTTPS redirect, secure cookies, HSTS, protected media, rate-limit cache, worker
   count, log level) is set by `docker-compose.yaml`; see SECURITY.md before changing any of it.
3. Domain: on the **web** service set `https://vrs.example.gov.ph` (port 80). Do not give the backend a domain; it is
   only reached through nginx.

On every start the backend runs `migrate`, `createcachetable`, `seed_reference` and `collectstatic`, then gunicorn.
All four are safe to repeat, so production migrations run automatically with each deploy.

## 4. Domain, DNS and HTTPS

1. Ask the DOLE network/DNS administrator for an `A` record: `vrs.example.gov.ph → <server public IP>` (or the
   internal DNS entry for an intranet-only deployment).
2. After DNS resolves (`nslookup vrs.example.gov.ph`), deploy. Coolify's proxy (Traefik) gets a Let's Encrypt
   certificate automatically and redirects HTTP to HTTPS. Intranet-only servers that Let's Encrypt cannot reach need a
   certificate from the DOLE IT office, added in Coolify → *Servers* → *Proxy*.
3. Plain-HTTP trial only: set `SECURE_SSL_REDIRECT=False` and `SECURE_COOKIES=False`, or login fails. Remove both
   before go-live.

Check: `https://vrs.example.gov.ph` shows the login page with a valid certificate; `http://` redirects to `https://`.

## 5. Persistent storage

`docker-compose.yaml` declares two named volumes, which survive redeploys:

- `media`: every upload (vehicle and driver photos, documents, attachments). The backend writes it; nginx reads it
  after Django's permission check. **Back it up with the database** (section 8).
- `static`: Django admin/API static files, rebuilt on each start; no backup needed.

Coolify prefixes the volume names with the resource ID (`docker volume ls | grep media`). To bring over existing
uploads: `docker cp backend/media/. <backend container>:/app/media/`.

Check: after uploading a photo (section 11), redeploy; the photo is still there.

## 6. First administrator

In Coolify → backend → *Terminal*:

```bash
python manage.py create_admin <username> --email <email> --first-name <first> --last-name <last>
```

It creates a System Administrator (with Django admin access for the TV display screens) and prints a one-time
password; the account must change it at first login. Then sign in, change the password, and create the offices and the
other users from **Users** in the app. Prefer this over `createsuperuser`: a superuser skips every permission check.

## 7. Scheduled jobs

Coolify → the VRS resource → *Scheduled Tasks*, container `backend`:

| Name | Command | Schedule |
|---|---|---|
| Notifications | `python manage.py run_notifications` | `0 6 * * *` (06:00 daily) |
| Expired sessions | `python manage.py clearsessions` | `30 2 * * *` |

`run_notifications` is idempotent: running it twice creates no duplicate alerts. Cron times follow the server's time
zone (section 1).

Check: run *Notifications* once by hand in Coolify; it prints "Created N new notification(s)", and the bell in the app
shows the expiry/maintenance alerts.

## 8. Backups

`deploy/backup.sh` (on the host, not in a container) writes one AES-256-encrypted file per run holding a
`mysqldump` of `vims` and a tar of the `media` volume, keeps 30 days, and can copy each file off the server and ping a
monitor. Policy (encryption, who may read them, off-site storage) is in [SECURITY.md](SECURITY.md#backups).

As root on the server:

```bash
git clone <repository> /opt/vrs                              # or copy the deploy/ folder only
apt install gnupg
cp /opt/vrs/deploy/backup.env.example /etc/vrs-backup.env && chmod 600 /etc/vrs-backup.env
nano /etc/vrs-backup.env                                     # container, volume, backup folder, off-site command
python3 -c "import secrets; print(secrets.token_urlsafe(32))" > /root/.vrs-backup-passphrase
chmod 600 /root/.vrs-backup-passphrase                       # give a copy to the System Administrator, kept off the server
/opt/vrs/deploy/backup.sh                                    # first run by hand
crontab -e                                                   # add: 15 1 * * * /opt/vrs/deploy/backup.sh >> /var/log/vrs-backup.log 2>&1
```

For the off-site copy, set `OFFSITE_CMD` (for example `rclone` to a DOLE file server or cloud bucket). Without it the
backups only protect against mistakes, not against losing the server.

Coolify's own database backups (database resource → *Backups*) may run as well, but they do not include the uploads, so
keep `backup.sh` either way.

Check (the "verify backups" step, repeat quarterly): `deploy/restore.sh --check <latest backup>` decrypts it and
reports the dump size and file count. Then restore it into a **staging** copy (a second Coolify resource with its own
MySQL and volume, and `VRS_BACKUP_CONFIG=/etc/vrs-staging.env`), start it, and open a few vehicles, documents and
attachments. Never test a restore on production: `restore.sh` replaces the whole database and every upload.

## 9. Logs

- Both containers log to the console; Coolify shows them per service (*Logs*). The backend log passes through
  `config.log_filters.RedactSecrets`.
- **Rotation:** `docker-compose.yaml` limits each container to 5 files of 10 MB (`json-file` driver), so logs cannot
  fill the disk. The backup log is rotated by adding `/etc/logrotate.d/vrs-backup`:
  ```
  /var/log/vrs-backup.log { weekly rotate 8 compress missingok notifempty }
  ```
- The audit trail (who changed what) is in the database, not the logs, and is kept indefinitely.

## 10. Health monitoring

- `GET /api/health/` answers `{"status": "ok"}` when the database answers and the media volume is writable, otherwise
  HTTP 503 `{"status": "error"}` (details only in the backend log). It needs no login and reveals nothing else.
- Docker runs it every 30 s as the backend's healthcheck; `web` starts only once the backend is healthy, and Coolify
  shows the containers as unhealthy if it fails.
- External monitor: point an uptime monitor (Coolify's notifications, Uptime Kuma, or the DOLE monitoring system) at
  `https://vrs.example.gov.ph/api/health/` every minute, alerting the System Administrator by email. Add the backup
  heartbeat (`HEARTBEAT_URL` in `/etc/vrs-backup.env`) as a push monitor that alerts when no backup arrived for 26 hours.
- Coolify → *Notifications*: turn on email for failed deployments and unhealthy containers. Watch disk space
  (Coolify → *Servers* → *Metrics*), since uploads and local backups grow it.

## 11. Go-live checks

### Data migration

After the client approves the import review (procedure in [MIGRATION.md](MIGRATION.md)). Take a backup first
(`deploy/backup.sh`). Then in the backend terminal, with the approved workbook copied in
(`docker cp filled.xlsx <backend container>:/tmp/`):

```bash
python manage.py import_workbook /tmp/filled.xlsx --user <admin username>            # dry run: compare with the approved review
python manage.py import_workbook /tmp/filled.xlsx --user <admin username> --commit
```

Copy the reports out before the next redeploy, since `import_runs/` is inside the container:
`docker cp <backend container>:/app/import_runs ./import_runs-<date>`.

### Smoke test

From any computer with Python 3.10+:

```bash
python deploy/smoke_test.py https://vrs.example.gov.ph --user <admin> --viewer <a Viewer account>
```

Read-only (it leaves login, logout and export entries in the audit trail). It checks the health endpoint, the app and
its security headers, the HTTPS redirect, that logged-out requests and the API docs are refused, every main list,
the dashboard, report preview and CSV/Excel/PDF export, that an existing photo and document file are served (and the
document is refused without a login), and that the Viewer cannot create records, read the audit trail or manage
users. Every line must say PASS (SKIP is fine before any file has been uploaded).

### By hand, with the client

- **Permissions:** sign in once as each role (System Administrator, Fleet Administrator, Field Office User, Viewer).
  The menu matches the role, a Field Office User sees only their office's vehicles, and only the System Administrator
  sees Users and Audit Log.
- **Reports:** run the Vehicle Master List, Fuel Cost and LTO expiration reports for the migrated data and compare the
  totals with the old workbook; export each as PDF and Excel.
- **File uploads:** add a vehicle photo, a document scan (PDF) and a trip attachment; open each again; sign out and
  confirm the document link no longer opens.
- **Backups:** the next morning, `/var/log/vrs-backup.log` shows "backup done", the file is off-site, and
  `restore.sh --check` passes on it.

Record the results and the client's acceptance on the sign-off sheet in [QA.md](QA.md).

## Updating and rolling back

- Update: merge to `main`, then *Redeploy* in Coolify. Migrations run on start. Take a backup first when the release
  has migrations (`git diff <deployed>..main --stat -- '*/migrations/*'`).
- Roll back code: redeploy the previous commit in Coolify (*Deployments* → the earlier one). Django migrations do not
  undo themselves; if the bad release changed the schema, restore the backup taken before it (section 8).
- Before each release run the checks at the top of [SECURITY.md](SECURITY.md#before-every-production-release).
