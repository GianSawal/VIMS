# QA and user acceptance testing

How the system is tested, the results of the Phase 17 QA run, and the scenarios for client UAT.

## Automated tests

```bash
# backend (from backend/)
DATABASE_URL=sqlite:///test.sqlite3 python -m pytest -q     # then delete test.sqlite3
# frontend (from frontend/)
npm test            # Vitest + React Testing Library
npm run lint && npm run build
```

| Suite | What it covers |
|---|---|
| Backend, per module (`*/test_*.py`) | CRUD, validation messages, business rules, uploads, notifications, reports, audit log, migration, per role |
| `config/test_security.py` | Every endpoint in the API schema: 401 logged out, refused without a role, Viewer read-only, office scoping, protected files, rate limits, headers, log redaction |
| `config/test_performance.py` | Every list, summary, dashboard and report endpoint keeps a fixed number of SQL queries as the data grows (no N+1), and stays at 25 queries or fewer |
| Frontend (`src/**/*.test.js(x)`) | API error messages (network, 500, 429, field errors), cache refresh, role-based navigation, route guards (login, forced password change, 403), table paging/empty/error states, confirm dialog, form field errors |

## Demo / QA environment

A separate backend on a throwaway SQLite database, so QA never touches the shared or production MySQL:

```bash
# backend/
export DATABASE_URL=sqlite:///qa.sqlite3 MEDIA_ROOT=qa_media \
       CORS_ALLOWED_ORIGINS=http://localhost:5174 CSRF_TRUSTED_ORIGINS=http://localhost:5174
python manage.py migrate && python manage.py createcachetable
python manage.py seed_demo                 # --scale 60 --months 12 for a load test
python manage.py runserver 8001
# frontend/
VITE_API_TARGET=http://127.0.0.1:8001 npx vite --port 5174
```

`seed_demo` creates realistic data and refuses any database except SQLite:
- 5 offices with 6 vehicles each;
- drivers, assignments, and documents in every expiry band;
- fuel, maintenance (one job open) and schedules;
- trips in every state, plus RFID accounts with tolls and notifications.

It also creates one login per role (`qa_sysadmin`, `qa_fleetadmin`, `qa_field` (Tarlac only), `qa_viewer`,
`qa_norole`). Their shared random password is written to `backend/qa-accounts.txt` (git-ignored).

## Phase 17 QA run (2026-10-28)

### Results

| Area | Result |
|---|---|
| Backend automated | 226 passed |
| Frontend automated | 20 passed; lint clean; production build OK |
| Browser, System Administrator | Every page opened (dashboard, all lists and details, reports, users, offices, audit log, data import); no console errors |
| Browser, Field Office User | Sees only Tarlac (6 vehicles); no add buttons; another office's vehicle and trip show 404; Users shows 403 |
| Browser, Viewer | All offices, no edit/archive/dispatch buttons; a direct `PATCH` to the API answers 403 |
| Browser, no role / logged out | Covered by `test_security.py` and the frontend route-guard tests |
| Uploads/downloads | A document scan opens for a logged-in user (200, `no-store`) and answers 401 without the session; CSV/Excel/PDF exports tested per report |
| Responsive (390 px wide) | Every page fits the screen after the fixes below; wide tables scroll inside their card |
| Performance | See below |

### Defects found and fixed

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | High | Driver Assignment report with one driver selected crashed (500) | `reports/catalog.py` filters by id; regression test |
| 2 | High | VEHICLE RECORD export took 95 s for 300 vehicles (over the 60 s gunicorn timeout) | The form's 1,000 empty formatted rows are trimmed before each vehicle sheet is copied; 20 s now (4.5 s for one office) |
| 3 | Medium | Excel export of large reports was quadratic (35 s for 6,000 trips) | Rows counted directly instead of re-reading `max_row`; 2.6 s now |
| 4 | Medium | Fuel list ran 1 query per vehicle on the page (usual km/L) | One query for the whole page (`fuel.vehicle_averages`) |
| 5 | Medium | Notifications list ran 2 queries per notification (link target) | Prefetched |
| 6 | Medium | Phones: dashboard, vehicle profile, documents, fuel scrolled sideways | Grids without a phone column count now get one shrinkable column (`index.css`); tab strips scroll; table header labels stay inside their table |
| 7 | Low | A server error showed only "Request failed." | Says the server had a problem and to tell the System Administrator if it repeats; rate limits show their wait message |

### Performance (300 vehicles, 12,250 trips, 7,892 fill-ups, SQLite on the dev PC)

| Request | Time |
|---|---|
| Dashboard | 129 ms (22 queries) |
| Lists (vehicles, trips, fuel, maintenance, documents, RFID, notifications) | 2 to 180 ms (1 to 3 queries) |
| Reports on screen | 4 ms to 0.9 s (trip history, half a year of trips) |
| Exports: trip history Excel (6,000 rows), master list PDF | 2.6 s, 1.1 s |
| VEHICLE RECORD workbook | 20.5 s, all 300 vehicles |

Known: the VEHICLE RECORD workbook still runs about 8 queries per vehicle (2,403 for 300). At RO3's size (about 21
vehicles) it is a few seconds. Batch those queries if the fleet grows into the hundreds.

### Not done in this run

- **Backup/restore test:** needs the staging MySQL and the backup job from Phase 18 (procedure in `docs/SECURITY.md`).
- **Other browsers:** only Chrome was tested. Check Edge and Firefox during UAT.
- **Error/recovery, partly done:**
  - covered: server errors, network loss, rate limits, session expiry (back to login) and all-or-nothing writes;
  - not covered: a database outage, or restarting a running deployment.

## UAT scenarios

Run on staging with the migrated data (Phase 15), not the demo data. Log each failure in the issue log below. Each
scenario lists the role, the steps and the expected result.

| ID | Role | Scenario | Expected |
|---|---|---|---|
| U01 | System Administrator | Create a Field Office User for Tarlac; log in as them | Forced to change the temporary password; sees only Tarlac records |
| U02 | System Administrator | Deactivate that user | They can no longer log in; their past entries keep their name in the audit log |
| U03 | Fleet Administrator | Add a vehicle with photo, OR/CR and LTO scans | Appears in the list and profile; scans open; plate duplicates are refused |
| U04 | Fleet Administrator | Assign the vehicle to an accountable person and driver, then reassign | History shows both assignments with dates; only one is current |
| U05 | Fleet Administrator | Renew the LTO registration | New document is current, old one moves to history; expiry alert stops |
| U06 | Field Office User | Book a trip for tomorrow, then dispatch it on the day with the odometer | Booking shows on the calendar and TV board; dispatch only allowed on the day; vehicle In Use |
| U07 | Field Office User | Record the return with the ending odometer, then record tolls and a reload from the trip | Distance computed; vehicle odometer moves forward; RFID balance updates |
| U08 | Field Office User | Record a fill-up with PO number and receipt scan | Total computed; km/L shown for full tanks; fill-up appears in the Fuel PO log |
| U09 | Field Office User | Open a maintenance job, move it to In Progress, complete it with costs | Vehicle shows Under Maintenance until completed; preventive schedule resets |
| U10 | Field Office User | Try to open a Pampanga vehicle by its link | "Page not found" |
| U11 | Viewer | Browse vehicles, trips, reports | Everything readable, nothing editable |
| U12 | Any | Run Vehicle Master List, Fuel Cost and Maintenance Expense for last quarter; export PDF and Excel | Totals equal the Fuel and Maintenance list summaries for the same filters |
| U13 | System Administrator | Open the audit log and filter by U03's vehicle | Every change from U03 to U09 is listed with before/after values |
| U14 | System Administrator | Export the VEHICLE RECORD workbook | Opens in Excel in the familiar RO3 layout, one sheet per plate |
| U15 | Any | Leave the app idle past the session time (8 h) and click something | Taken to the login page; after login, back to work |
| U16 | Any | Use the app on a phone | Pages fit the screen; menu opens from the top-left button |
| U17 | System Administrator | Show the TV board link on a lobby screen | Shows today's trips with no login and no sensitive fields; revoking the screen stops it |
| U18 | Any | Check the dashboard after the daily alert run | Expiring documents, licenses and due maintenance match the lists |

### Issue log

| # | Date | Scenario | Reported by | What happened | Severity (Blocker / Critical / Major / Minor) | Status | Fixed in |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Severity: **Blocker** = a scenario can't be finished; **Critical** = wrong data or a security problem; **Major** = works
with a workaround; **Minor** = cosmetic. Blockers and criticals are fixed and retested before sign-off.

### Sign-off

| | Name | Position | Signature | Date |
|---|---|---|---|---|
| Client representative | | | | |
| System owner (DOLE RO3) | | | | |
| Developer | | | | |
