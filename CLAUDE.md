# DOLE VRS (Vehicle Records System)

Formerly named VIMS; the repo, folder, database (`vims`) and spec file names keep the old name on purpose.

React (Vite, Tailwind v4) + Django REST Framework + MySQL. Replaces DOLE's spreadsheet-based vehicle records.

- Spec: `DOLE_VIMS_MASTER_PROMPT_BRANDED.md`. Progress tracker: `DOLE_VIMS_TASKS_PHASE_CHECKLIST_BRANDED.md`.
- Schema and rule locations: `docs/ERD.md`. Setup, endpoints, branding palette: `README.md`.

## Working rules

- **Update the checklist in the same turn as the work.** Tick `[x]` only items that meet the Definition of Done; add a short note for partial or deferred ones.
- Build one phase at a time, in order: model, service/rules, API + permissions, tests, React UI, docs, checklist.
- Business rules are enforced in the backend; the UI only mirrors them. Never rely on hidden buttons for security.
- Git: `main` (release) and `develop` (integration). Work on `feature/p<N>-<name>`. Never commit `.env`, secrets or `media/`.
- Don't add data to the shared MySQL (`backend/.env` `DATABASE_URL`) for experiments; use a throwaway SQLite database.

## Commands (run from `backend/` or `frontend/`)

```bash
# backend (Windows venv: .venv\Scripts\python)
python manage.py migrate && python manage.py seed_reference   # re-run seed after adding permissions
python manage.py runserver                                    # :8000, Swagger at /api/docs/
DATABASE_URL=sqlite:///test.sqlite3 python -m pytest -q       # then delete test.sqlite3
DATABASE_URL=sqlite:///qa.sqlite3 python manage.py seed_demo  # demo/QA data + one login per role (SQLite only; docs/QA.md)

# frontend
npm run dev      # :5173, proxies /api and /media to Django
npm test         # Vitest + Testing Library (src/**/*.test.jsx)
npm run build && npm run lint
```

Tests run on SQLite because the MySQL user has no rights on `test_vims`. If that is granted, plain `pytest` works.
MySQL-specific behavior (CHECK constraints, generated columns) was verified manually; SQLite accepts them too.

## Backend conventions

- Apps: `accounts` (User, Office), `fleet` (Vehicle, Driver, assignments, documents, Attachment), `operations` (trips, fuel, RFID/toll), `maintenance`, `notifications`, `audit`. Shared helpers are in `config/base_models.py` (`Tracked`, `non_negative`, `ordered`, `safe_upload_to`).
- Auth is Django session plus CSRF cookie. Logged-out requests get **401**, forbidden **403**, out-of-office records **404**.
- **Permissions:** viewsets inherit `accounts.permissions.OfficeScopedMixin` and set `office_field` (the lookup path to Office). Roles are Django Groups created by `seed_reference`. Roles with `accounts.view_all_offices` see every office.
- **Custom `@action` endpoints:** DRF maps POST to `add_*` and DELETE to `delete_*`, which is usually wrong. Use `accounts.permissions.require(...)` and check extra permissions inside the action.
- **No DELETE endpoints.** Archive or deactivate instead, so history and reports stay intact.
- **Audit:** call `audit.services.log(request, action, entity, description, changes)` from views; use `diff()` for before/after (`{'field': [old, new]}`; creations log `{'after': snapshot}`). The audit log is append-only: `AuditLog.save()` refuses updates and `delete()` always fails, and `/api/audit-logs/` (+ `/facets/`) is read-only with `audit.view_auditlog`, which only System Administrator has. The log has no office, so never grant that permission to office-limited roles. Never log secrets (mask RFID numbers, no passwords).
- **Optional unique identifiers** (plate, property, engine, chassis, license, employee number) are uppercased, trimmed, and stored as `NULL` when blank, because MySQL `UNIQUE` allows many NULLs but not many empty strings. Check uniqueness in `validate()` after normalizing.
- MySQL has no partial unique index. "Plate unique among non-archived" and "one open assignment per vehicle" are enforced in code; the assignment service locks the vehicle row (`select_for_update`).
- Odometer, money and quantity fields have DB CHECK constraints; totals and trip distance are `GeneratedField`s.
- Uploads: validate real content (Pillow or PDF magic bytes), not just the extension; files get random names via `safe_upload_to`; delete the old file in `transaction.on_commit`.
- Trip lifecycle: SCHEDULED (no odometer) → DISPATCHED (odometer read on the scheduled day) → COMPLETED, or CANCELLED. Direct dispatch skips SCHEDULED. `/display?token=` is the public TV board (`DisplayScreen`, no login); keep sensitive fields out of `DisplayTripSerializer`.
- Maintenance: `maintenance/service.py` owns the status flow (forward only), the vehicle's Under Maintenance status, schedule reset on completion, and `schedule_state()` (due = either the day or the km interval; due soon within `MAINTENANCE_DUE_SOON_DAYS/_KM`).
- Business workflows live in service modules (`fleet/assignments.py`, `operations/trips.py`, `operations/fuel.py`) that lock the vehicle row; views only validate input, call the service and audit. Add new state transitions there, not in serializers.
- Documents: `fleet/documents.py` owns create/renew/cancel and the expiry bands (`expiry_state`, `band_filter`, thresholds `DOCUMENT_ALERT_DAYS`). Renewal = new ACTIVE row, old one SUPERSEDED; vehicle and type never change. Phase 11 alerts should dedupe on `doc:<id>:<band>`.
- Any record that needs files: add `fleet.attachments_api.AttachmentsMixin` to its viewset (uses the model's view/change permissions) and render `components/Attachments.jsx` with `basePath`.
- Maps: LocationIQ (default) or Geoapify, picked by `MAPS_PROVIDER` (the other one is the automatic fallback when both keys are set), run server-side only (`operations/maps.py`, `/api/maps/*`, keys `LOCATIONIQ_API_KEY` / `GEOAPIFY_API_KEY`); never put the key in the frontend. The browser draws OpenStreetMap tiles with React Leaflet (`components/TripMap.jsx`, lazy-loaded). Without the key the trip forms fall back to plain text.
- RFID / toll: `operations/toll.py` owns the rules. A toll transaction is a load (credit) or a charge (debit), never both; `/toll-transactions/batch/` records a reload plus several tolls from one trip as separate rows in one atomic write. Running balance is cumulative credit-debit in time order (computed in `/rfid-accounts/{id}/transactions/`, not the main list). Account numbers are masked (last 4) for users without `change_rfidaccount`, even in audit logs; unassigned accounts (null vehicle) are visible to every office.
- Reports: `reports/catalog.py` registers each report with `@report` (perms, filters, status/group-by choices) and returns columns (with a `kind`), rows and totals; `reports/export.py` turns that one result into CSV, Excel (openpyxl) and PDF (reportlab), so every format shows the same figures. Totals follow the list summaries (completed maintenance only, ACTIVE documents, trips by departure date). Add a report there; the React page (`pages/reports/Reports.jsx`) renders whatever the API describes.
- Migration: `dataimport/importer.py` (`SHEETS` defines the import workbook's columns and parsers, used for both the template and reading) and `manage.py import_workbook` (dry run unless `--commit`, backup + review report in `backend/import_runs/`, git-ignored). It writes models directly with `full_clean()` (not the live services), skips rows already imported, and only fills blank fields of existing vehicles/drivers. Rules and mapping: `docs/MIGRATION.md`.
- `RFIDAccount` intentionally has no password field (spec: no plaintext third-party credentials).
- Security (`docs/SECURITY.md`):
  - `config/test_security.py` walks every endpoint in the OpenAPI schema. A new endpoint must answer 401 logged out and refuse users without a role, or be added on purpose to `PUBLIC`/`OWN` there. A new office-scoped viewset needs a record in the test's `far` fixture.
  - In detail actions call `self.get_object()` before validating input, so the office check (404) comes first.
  - Uploaded files are served by `config/media.py`, never by a static route: photos are public, documents and attachments follow the record's permission and office. A new `FileField` must be added there.
  - Rate limits live in `accounts/throttles.py` and `DEFAULT_THROTTLE_RATES`.
  - Log output passes through `config.log_filters.RedactSecrets`; still never log secrets on purpose.
- Deployment: `docs/DEPLOYMENT.md` is the runbook. `/api/health/` (`config/health.py`, plain Django view, public, exempt from the HTTPS redirect) backs the compose healthcheck. `deploy/` holds host-side scripts: `backup.sh`/`restore.sh` (encrypted dump + media volume) and `smoke_test.py` (stdlib only, read-only). First admin: `manage.py create_admin`. Anything the container writes outside a volume must be created and chowned in the `Dockerfile` (it runs as `app`).
- Performance: `config/test_performance.py` fails when a list, summary, dashboard or report endpoint's query count grows with the data, or exceeds 25. Batch per-row lookups (prefetch, one query per page) instead of raising the limit. In openpyxl never read `ws.max_row`/`max_column` inside a loop (each read scans every cell).

## Frontend conventions

- `src/api.js`: `api` (axios with CSRF), `useList(path, params)`, `applyFieldErrors` (maps DRF errors onto form fields), `invalidatePrefix` (refresh cached queries by API path).
- Query keys are `[path, params]` for lists and `['/things/', id]` for details, so `invalidatePrefix(qc, '/vehicles/')` refreshes both.
- List filters live in the URL (`useSearchParams`) so dashboard cards can link to filtered views.
- Permission UI uses `useCan()` and `<RequirePerm>`; these are hints only, the API enforces the same permissions.
- Reuse `components/ui.jsx` (Button, Field, Modal, ConfirmDialog, Badge), `components/DataTable.jsx` (takes a `toolbar` and `onRowClick`) and `components/filters.jsx` (Toolbar, SearchBox, StatCard/CardGrid, Avatar). List pages follow one pattern: status/role cards on top, a toolbar attached to the table card, filter chips. Use `inputBase` (no width) for filter controls and `inputClass` (full width) for form fields; mixing `inputClass` with `w-44` does not work because `w-full` wins. Money is Philippine pesos via `Intl.NumberFormat('en-PH')`.
- Routes for unbuilt phases render `<Pending>` in `App.jsx`; replace the entry when building the phase.
- Layout: a bare `grid` gets one shrinkable column by default (`index.css`), so `grid lg:grid-cols-3` is safe on phones. Tables go through `DataTable` (its scroll box is `relative`, which keeps `sr-only` header labels from widening the page). Tab strips use `max-w-full overflow-x-auto` with `shrink-0 whitespace-nowrap` buttons.
- Tests: `src/test/render.jsx` (`renderApp` with a seeded `me` and query data, no network); `npm test`.
- Animation uses `motion` (Framer Motion, `import { motion, AnimatePresence } from 'motion/react'`). `<MotionConfig reducedMotion="user">` in `main.jsx` handles reduced motion. `Modal` keeps the native `<dialog>` open until its exit animation finishes.

## Branding

Logo is `IMAGES/DOLE.png` (served from `frontend/public/dole-logo.png`). Use only the theme tokens in `frontend/src/index.css` (`brand`, `accent`, `danger`, `gold`, `ink`). The logo red (`accent`) is decorative only; use `danger` for error text and destructive buttons.

## Environment notes

- Windows with Git Bash. Long heredocs containing quotes can break the shell; write files with the editor tools instead.
- `.gitattributes` forces LF; Git's CRLF warnings on Windows are harmless.
- After adding or changing a token in `frontend/src/index.css` `@theme`, restart `npm run dev`; the running dev server can keep serving the old CSS (symptom: elements using the new token render invisible, e.g. chart bars).
