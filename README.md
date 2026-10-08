# DOLE VIMS: Vehicle Information Management System

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
| `/api/trips/{id}/complete/` | POST `{returned_at, odometer_end, remarks?}` | moves the vehicle odometer forward; vehicle back to Serviceable |
| `/api/trips/{id}/cancel/` | POST `{reason}` | open trips only; odometer untouched |
| `/api/trips/{id}/attachments/` | GET / POST / DELETE `…/{att_id}/` | same rules as driver attachments |
| `/api/drivers/` | CRUD (no delete) | `?search= &office= &is_active= &license_status=VALID\|EXPIRING\|EXPIRED` |
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
