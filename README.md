# DOLE VRS: Vehicle Records System

> Renamed from VIMS (Vehicle Information Management System). The repository, folders, database name (`vims`) and the
> original spec/checklist file names keep the old name.

React (Vite) + Django REST Framework + MySQL.

- Spec: [DOLE_VIMS_MASTER_PROMPT_BRANDED.md](DOLE_VIMS_MASTER_PROMPT_BRANDED.md)
- Phase checklist: [DOLE_VIMS_TASKS_PHASE_CHECKLIST_BRANDED.md](DOLE_VIMS_TASKS_PHASE_CHECKLIST_BRANDED.md)

```
backend/    Django project (config/) + apps:
              accounts       User, Office, roles (Groups)
              fleet          Vehicle, Driver, VehicleAssignment, VehicleDocument, Attachment
              operations     Trip, FuelRecord (+ Fuel PO log), RFIDAccount, TollTransaction
              maintenance    MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule
              notifications  Notification
              audit          AuditLog
docs/       ERD and design notes
frontend/   React SPA (Vite, Tailwind v4, React Router, TanStack Query, RHF + Zod, Lucide)
IMAGES/     Official logo source
```

## Setup

Prerequisites: Python 3.12+, Node 20+, MySQL 8.

### Database

```sql
CREATE DATABASE dole_vims CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vims'@'localhost' IDENTIFIED BY 'vims_password';
GRANT ALL PRIVILEGES ON dole_vims.* TO 'vims'@'localhost';
-- test runner creates test_dole_vims, so dev also needs:
GRANT ALL PRIVILEGES ON test_dole_vims.* TO 'vims'@'localhost';
```

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows  (source .venv/bin/activate on Linux/macOS)
pip install -r requirements.txt
copy .env.example .env          # then set SECRET_KEY and DATABASE_URL
python manage.py migrate
python manage.py seed_reference  # role groups + maintenance categories (idempotent)
python manage.py createsuperuser
python manage.py runserver      # http://127.0.0.1:8000
pytest                          # tests
```

API docs: http://127.0.0.1:8000/api/docs/ (Swagger), schema at `/api/schema/`.

### Frontend

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

The Vite dev server proxies `/api` and `/media` to Django (`VITE_API_TARGET`, default `http://127.0.0.1:8000`),
so session and CSRF cookies are same-origin.

## Auth

Django session in an HttpOnly cookie plus CSRF token. The SPA calls `GET /api/auth/csrf/` once, then sends
`X-CSRFToken` on writes (handled by the axios instance in `frontend/src/api.js`).

| Endpoint | Method | |
|---|---|---|
| `/api/auth/csrf/` | GET | sets `csrftoken` cookie |
| `/api/auth/login/` | POST | `{username, password}`, rate-limited 10/min |
| `/api/auth/logout/` | POST | |
| `/api/auth/me/` | GET | current user, role, offices, permissions |
| `/api/auth/change-password/` | POST | `{current_password, new_password}` |
| `/api/users/` | CRUD (no delete) | System Administrator only; `POST /api/users/{id}/reset-password/` |
| `/api/offices/` | CRUD (no delete) | scoped to the user's offices |
| `/api/vehicles/` | CRUD (no delete) | `?search= &status= &office= &vehicle_type= &is_archived=true &ordering=` |
| `/api/vehicles/{id}/archive/` · `/reactivate/` | POST | needs `fleet.change_vehicle` |
| `/api/vehicles/{id}/assignments/` | GET history / POST assign or reassign | POST needs `add` + `change` on `vehicleassignment`; ends the current assignment on the start date |
| `/api/vehicles/{id}/end-assignment/` | POST `{end_date}` | leaves the vehicle unassigned |
| `/api/trips/` | GET list · POST dispatch · PATCH descriptive fields | `?status= &vehicle= &driver= &office= &date_from= &date_to= &search=`; `GET /api/trips/summary/` for counts and distance |
| `/api/trips/schedule/` | POST | book ahead: `{vehicle, driver, scheduled_departure, scheduled_return?, origin, destination, purpose, …}`; no odometer |
| `/api/trips/{id}/dispatch/` | POST `{odometer_start, departed_at?}` | scheduled trips only, **on the scheduled day**; odometer read then |
| `/api/trips/{id}/reschedule/` | POST `{vehicle, driver, scheduled_departure, scheduled_return?}` | scheduled trips only; no double-booking |
| `/api/display-screens/` | GET | TV screens and their links (needs `operations.view_displayscreen`); created/revoked in Django admin; Trips page → **TV board** |
| `/api/display/trips/?token=` | GET (no login) | TV board data: today + next 7 days, display-safe fields only; rate-limited |
| `/api/trips/{id}/complete/` | POST `{returned_at, odometer_end, remarks?}` | moves the vehicle odometer forward; vehicle back to Serviceable |
| `/api/trips/{id}/cancel/` | POST `{reason}` | open trips only; odometer untouched |
| `/api/trips/{id}/attachments/` | GET / POST / DELETE `…/{att_id}/` | same rules as driver attachments |
| `/api/fuel-records/` | CRUD (no delete) | `?vehicle= &driver= &office= &fuel_type= &date_from= &date_to= &has_po=true &is_full_tank= &search=`; total computed if blank; returns `distance_since_last`, `km_per_liter` (estimate, full tank to full tank), `unusual` |
| `/api/fuel-records/insights/` | GET | chart data for the same filters: cost/liters per month (last 12 months, or the date range) and top 5 vehicles by cost |
| `/api/maintenance/` | CRUD (no delete) | `?vehicle= &status= &category= &office= &open=true &date_from= &date_to= &search=`; `summary/`, `insights/` for cards and charts; `attachments/` |
| `/api/maintenance/{id}/status/` | POST `{status, completed_on?, odometer?, labor_cost?, parts_cost?, next_service_*?}` | forward-only flow; completing resets preventive schedules |
| `/api/maintenance-schedules/` | CRUD (no delete) | per vehicle + category; `due` computed live: `OVERDUE`, `DUE_SOON`, `OK`, `NO_BASELINE`; `?due=`, `summary/` |
| `/api/maintenance-categories/` | list / create / update | reference list (unpaginated) |
| `/api/fuel-records/summary/` | GET | count, liters, amount, average price for the same filters |
| `/api/fuel-records/{id}/attachments/` | GET / POST / DELETE | receipt and PO scans |
| `/api/documents/` | CRUD (no delete), multipart `file` | `?vehicle= &document_type=OR,CR &status=ACTIVE &band=EXPIRED\|7\|15\|30\|60\|VALID\|NONE &office= &search=`; soonest expiry first; detail includes `history` |
| `/api/documents/{id}/renew/` | POST `{reference_number, issue_date, expiry_date, file?, remarks}` | new current document; the old one becomes `SUPERSEDED` (needs add + change) |
| `/api/documents/{id}/cancel/` | POST `{reason}` | wrong entry: kept, stops alerting |
| `/api/documents/summary/` | GET | current documents per expiry band and per type |
| `/api/drivers/` | CRUD (no delete) | `?search= &office= &is_active= &license_status=VALID\|EXPIRING\|EXPIRED` |
| `/api/drivers/{id}/photo/` | POST (multipart `photo`) / DELETE | needs `fleet.change_driver`; same rules as vehicle photos |
| `/api/drivers/{id}/assignments/` | GET | the driver's vehicle history |
| `/api/drivers/{id}/attachments/` | GET / POST multipart `file`, `description` · `DELETE …/attachments/{att_id}/` | PDF/JPEG/PNG/WebP ≤ `ATTACHMENT_MAX_BYTES`; changes need `fleet.change_driver` |
| `/api/vehicles/{id}/photo/` | POST (multipart `photo`) / DELETE | needs `fleet.manage_vehicle_photo`; JPEG/PNG/WebP ≤ `VEHICLE_PHOTO_MAX_BYTES` |

Unauthenticated requests get **401**; authenticated but not permitted get **403**; records outside the user's
offices get **404**. Users flagged `must_change_password` get 403 everywhere except me/change-password/logout.

### Roles and office scoping

Role = Django Group (permissions set by `seed_reference`). System Administrator, Fleet Administrator and Viewer hold
`accounts.view_all_offices`; Field Office Users only see records of offices in `User.offices`. New viewsets get
this by inheriting `accounts.permissions.OfficeScopedMixin` and setting `office_field`.

## Branding

Logo: `IMAGES/DOLE.png` (the only candidate in the folder), copied to `frontend/public/dole-logo.png`.
`frontend/public/dole-emblem.png` is the triangle emblem cropped from that same file (no wordmark), used on the blue
login panel where the small wordmark would be unreadable.
Tokens are in `frontend/src/index.css` (`@theme`), used as Tailwind classes such as `bg-brand` and `text-danger`.

| Token | Hex | Source / use |
|---|---|---|
| `brand` | `#0305BA` | Logo blue. Primary buttons, nav, headings |
| `brand-dark` | `#020390` | Hover/pressed |
| `brand-light` | `#E8E9FB` | Active nav, subtle fills |
| `accent` | `#FF0103` | Logo red. Decorative only (3.9:1 on white, fails AA for text) |
| `danger` | `#C40002` | Darkened red for error text and destructive buttons |
| `gold` | `#FFC603` | Logo stars. Focus ring, highlights |
| `ink` | `#2F2F2F` | Logo wordmark. Body text |

## Git workflow

- `main`: production-ready. `develop`: integration.
- Feature branches: `feature/<phase>-<short-name>` (e.g. `feature/p4-vehicle-crud`), `fix/<short-name>`.
- Merge to `develop` via pull request with review.

## Trip schedule TV display

1. Django admin → **Operations › Display screens** → *Add*: give it a name (e.g. "Lobby TV, Regional Office") and,
   optionally, an office to show only that office's vehicles.
2. Save, then copy the **Display link** shown (`/display?token=…`) and open it full-screen on the TV's browser,
   e.g. `https://<server>/display?token=…`. No staff login is needed.
3. To revoke a screen, untick **is active**; the TV then shows "Display not set up".

The board shows today's trips (scheduled, on trip, returned, cancelled) and the next 7 days of bookings, refreshes
every minute, pages long lists, flags delayed departures and overdue returns, and never receives passengers,
purpose, remarks or odometer readings.

## Trip map: place search, route and distance (LocationIQ or Geoapify + OpenStreetMap)

Optional. Without a key the trip forms use plain text boxes and still offer an "Open in OpenStreetMap" link.

Two providers are supported; both use OpenStreetMap data. **LocationIQ is the default** because it finds Philippine
government offices better (e.g. "Department of Labor and Employment, San Fernando"). Search by the office's full
name; abbreviations like "DOLE RO III" are often not in the map data.

1. Create a free account at https://locationiq.com (or https://myprojects.geoapify.com) and copy the access token.
2. In `backend/.env` set `MAPS_PROVIDER=locationiq` and `LOCATIONIQ_API_KEY=...`
   (or `MAPS_PROVIDER=geoapify` and `GEOAPIFY_API_KEY=...`), then restart Django. Keys are used only by Django and
   never sent to the browser. Restrict them to the server's IP / referrer in the provider's dashboard.
3. Set **both** keys to get automatic fallback: when the main provider fails (daily or per-second limit used up,
   outage, place not found) the request is retried on the other one. The map credit names both.
4. LocationIQ's free plan allows about 2 requests per second; the form debounces typing and shows a friendly
   "busy" message if the limit is hit.

How it works: the schedule/dispatch form searches places through `GET /api/maps/autocomplete/?q=` (Philippines only)
and, once origin and destination are picked, calls `POST /api/maps/route/` `{origin: {lat, lon} | {address},
destination: ...}`. The response (one-way `distance_km`, `duration_min`, `origin`, `destination`, `geometry` as
`[[lat, lng], ...]`, thinned to 400 points) is drawn with React Leaflet on OpenStreetMap tiles and saved on the trip:
`estimated_distance_km`, `estimated_duration_min`, `origin_lat/lng`, `destination_lat/lng`, `route_geometry`.
Both endpoints need `operations.add_trip` and are rate-limited (120/min per user). `GET /api/maps/status/` tells the
UI whether maps are on. The trip page redraws the saved route without calling Geoapify again.

Attribution (shown on the map, required): "© OpenStreetMap contributors" and the active provider (LocationIQ or Geoapify). OpenStreetMap's
public tile server is fine for light internal use; switch tile provider if usage grows.
