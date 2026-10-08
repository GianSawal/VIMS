# DOLE VIMS (Vehicle Information Management System)

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

# frontend
npm run dev      # :5173, proxies /api and /media to Django
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
- **Audit:** call `audit.services.log(request, action, entity, description, changes)` from views; use `diff()` for before/after. The audit log is append-only.
- **Optional unique identifiers** (plate, property, engine, chassis, license, employee number) are uppercased, trimmed, and stored as `NULL` when blank, because MySQL `UNIQUE` allows many NULLs but not many empty strings. Check uniqueness in `validate()` after normalizing.
- MySQL has no partial unique index. "Plate unique among non-archived" and "one open assignment per vehicle" are enforced in code; the assignment service locks the vehicle row (`select_for_update`).
- Odometer, money and quantity fields have DB CHECK constraints; totals and trip distance are `GeneratedField`s.
- Uploads: validate real content (Pillow or PDF magic bytes), not just the extension; files get random names via `safe_upload_to`; delete the old file in `transaction.on_commit`.
- `RFIDAccount` intentionally has no password field (spec: no plaintext third-party credentials).

## Frontend conventions

- `src/api.js`: `api` (axios with CSRF), `useList(path, params)`, `applyFieldErrors` (maps DRF errors onto form fields), `invalidatePrefix` (refresh cached queries by API path).
- Query keys are `[path, params]` for lists and `['/things/', id]` for details, so `invalidatePrefix(qc, '/vehicles/')` refreshes both.
- List filters live in the URL (`useSearchParams`) so dashboard cards can link to filtered views.
- Permission UI uses `useCan()` and `<RequirePerm>`; these are hints only, the API enforces the same permissions.
- Reuse `components/ui.jsx` (Button, Field, Modal, ConfirmDialog, Badge), `components/DataTable.jsx` (takes a `toolbar` and `onRowClick`) and `components/filters.jsx` (Toolbar, SearchBox, StatCard/CardGrid, Avatar). List pages follow one pattern: status/role cards on top, a toolbar attached to the table card, filter chips. Use `inputBase` (no width) for filter controls and `inputClass` (full width) for form fields; mixing `inputClass` with `w-44` does not work because `w-full` wins. Money is Philippine pesos via `Intl.NumberFormat('en-PH')`.
- Routes for unbuilt phases render `<Pending>` in `App.jsx`; replace the entry when building the phase.

## Branding

Logo is `IMAGES/DOLE.png` (served from `frontend/public/dole-logo.png`). Use only the theme tokens in `frontend/src/index.css` (`brand`, `accent`, `danger`, `gold`, `ink`). The logo red (`accent`) is decorative only; use `danger` for error text and destructive buttons.

## Environment notes

- Windows with Git Bash. Long heredocs containing quotes can break the shell; write files with the editor tools instead.
- `.gitattributes` forces LF; Git's CRLF warnings on Windows are harmless.
