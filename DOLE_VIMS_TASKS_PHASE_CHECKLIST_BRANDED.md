# DOLE Vehicle Records System (VRS)

> Renamed from VIMS (Vehicle Information Management System) on 2026-10-08.

## Development Tasks and Phase Checklist

> Recommended stack: React.js + Django REST Framework + MySQL

Use this file as the project's implementation checklist. Check an item
only when it meets the project's Definition of Done.

------------------------------------------------------------------------

# Phase 0 --- Requirements and Planning

-   [ ] Confirm system name and project scope
-   [ ] Identify project owner/client representatives
-   [ ] Identify System Administrator, Fleet Administrator, Field Office
    User, and Viewer roles
-   [ ] Confirm participating Regional/Field Offices
-   [x] Review the existing Vehicle Record Excel workbook (`DATA/VEHICLE RECORD.xlsx`: RO3 master + one sheet per vehicle)
-   [x] Document all current Excel columns and meanings (`docs/MIGRATION.md`, old sheet → template mapping)
-   [ ] Identify duplicate/inconsistent source data (partial: the converter's notes list plate conflicts and log balances that don't add up; client review pending)
-   [ ] Confirm required vehicle statuses
-   [ ] Confirm trip-ticket workflow
-   [ ] Confirm fuel/PO workflow
-   [ ] Confirm maintenance workflow
-   [ ] Confirm LTO/GSIS renewal process
-   [ ] Confirm RFID/Easytrip requirements
-   [ ] Decide whether third-party credentials should be excluded from
    the new system
-   [ ] Confirm required reports
-   [ ] Confirm document retention rules
-   [ ] Confirm approval workflows, if any
-   [x] Create initial ERD (`docs/ERD.md`; pending client review)
-   [ ] Create system flow diagram
-   [ ] Create wireframes
-   [ ] Approve MVP scope

**Phase gate:** Client agrees on scope, workflows, roles, required
fields, and reports.

------------------------------------------------------------------------

# Phase 1 --- Project Setup

## Repository

-   [x] Create Git repository (github.com/GianSawal/VIMS, branches `main` + `develop`)
-   [x] Add `.gitignore`
-   [x] Define `main` and `develop` workflow (README)
-   [x] Define feature branch naming (README)
-   [x] Create README
-   [x] Create environment setup instructions

## Backend

-   [x] Create Django project
-   [x] Install Django REST Framework
-   [x] Configure MySQL (remote 10.6.8.96:3311, db `vims`)
-   [x] Configure `.env`
-   [x] Configure CORS/CSRF
-   [x] Create base apps/modules
-   [x] Configure API versioning/prefix (`/api/` prefix; URL versioning deferred until a v2 is needed)
-   [x] Configure OpenAPI/Swagger (`/api/docs/`)
-   [x] Configure logging
-   [x] Configure media/file storage
-   [x] Create test configuration (pytest-django)

## Frontend

-   [x] Create React/Vite project
-   [x] Configure React Router
-   [x] Configure Axios/API client
-   [x] Configure TanStack Query or equivalent
-   [x] Configure form/validation libraries (React Hook Form + Zod)
-   [x] Configure styling/component system (Tailwind v4)
-   [x] Create base layout
-   [x] Create route structure
-   [x] Configure environment variables
-   [ ] Add global error handling — partial: `errorMessage()` helper + query retry policy; React error boundary still to add

**Phase gate:** Both developers can clone the repository, configure
environments, run React, run Django, and connect to MySQL.

------------------------------------------------------------------------


### VIMS Logo and Theme Integration
- [x] Locate the official VIMS logo in the project's `IMAGES` folder (`IMAGES/DOLE.png`)
- [x] Confirm the correct logo if multiple candidates exist (single candidate)
- [x] Identify logo primary, secondary and accent colors
- [x] Define reusable theme tokens in CSS/Tailwind
- [x] Display logo on login page
- [x] Display logo in sidebar/header
- [x] Preserve logo aspect ratio and image quality
- [ ] Match buttons, navigation, cards, badges and charts to the logo palette — buttons/nav done; cards/badges/charts as built
- [ ] Verify accessible contrast and visible focus indicators
- [ ] Verify responsive appearance across desktop and mobile
- [x] Document logo asset path and selected colors (README → Branding)
- [ ] Confirm branding consistency during UAT


# Phase 2 --- Database and Core Architecture

-   [x] Create Office model
-   [x] Create/customize User model if required (`offices` M2M, `must_change_password`)
-   [x] Configure Django Groups/Permissions (`manage.py seed_reference`)
-   [x] Create Vehicle model
-   [x] Create Driver model
-   [x] Create VehicleAssignment model
-   [x] Create Trip model
-   [x] Create FuelRecord model
-   [x] Create MaintenanceRecord model
-   [x] Create MaintenanceCategory model
-   [x] Create MaintenanceSchedule model
-   [x] Create VehicleDocument model
-   [x] Create RFIDAccount model
-   [x] Create TollTransaction model
-   [x] Create Notification model
-   [x] Create AuditLog model
-   [x] Create attachment/reference models as needed (generic `Attachment`)
-   [x] Add indexes for frequently searched fields
-   [x] Add unique constraints
-   [x] Add model validation (DB CHECK constraints + `clean()`; tests in `fleet/test_models.py`)
-   [x] Generate migrations (applied to MySQL `vims`)
-   [x] Review ERD against implemented schema
-   [ ] Seed reference data for development (partial: roles + maintenance categories seeded; offices waiting on the client's office list)

**Phase gate:** Schema is normalized, migrations work on a clean MySQL
database, and relationships match approved workflows.

------------------------------------------------------------------------

# Phase 3 --- Authentication, RBAC and Office Scoping

-   [x] Login endpoint
-   [x] Logout endpoint
-   [x] Current-user endpoint (role, offices, permissions)
-   [x] Password change/reset (self-service change + admin reset with forced change; email reset not in scope yet)
-   [x] User activation/deactivation
-   [x] Role/group management (role assignment in Users page; role permissions via `seed_reference`)
-   [x] Office assignment
-   [x] Backend permission classes (`accounts/permissions.py`)
-   [x] Object/office-level data filtering (`OfficeScopedMixin`, `view_all_offices` permission)
-   [x] Protected React routes
-   [x] Role-aware navigation
-   [x] Unauthorized page (401 redirects to login)
-   [x] Forbidden page
-   [x] Session/token expiry handling (8h session; 401 interceptor returns to login)
-   [x] Authentication tests
-   [x] Cross-office access tests

**Phase gate:** A Field Office User cannot access unauthorized office
records even by directly calling the API.

------------------------------------------------------------------------

# Phase 4 --- Vehicle Master Module

## Backend

-   [x] Vehicle CRUD API (no DELETE; archive instead)
-   [x] Vehicle search
-   [x] Vehicle filtering
-   [x] Vehicle sorting
-   [x] Pagination
-   [x] Vehicle status validation (disposed is terminal; archived is read-only)
-   [x] Vehicle image upload
-   [x] Archive/reactivate vehicle
-   [x] Plate/property/engine/chassis uniqueness rules (case-insensitive; plate unique among active)
-   [x] Vehicle permissions
-   [x] Vehicle tests (`fleet/test_vehicles.py`)

## Frontend

-   [x] Vehicle master list
-   [x] Search bar
-   [x] Office filter
-   [x] Status filter (clickable status cards with live counts, active-filter chips)
-   [x] Vehicle type filter
-   [x] Add Vehicle form
-   [x] Edit Vehicle form
-   [x] Vehicle status badges
-   [x] Vehicle profile layout
-   [x] Overview tab
-   [x] Empty/loading/error states
-   [x] Confirmation dialogs

**Phase gate:** Users can securely create, locate, view, update and
archive vehicles according to role/office permissions.

------------------------------------------------------------------------

### Vehicle Profile Photo Upload (Admin)
- [x] Add vehicle photo field/storage model and migration (`Vehicle.photo`, random file names)
- [x] Configure Django media storage for vehicle photos
- [x] Create authenticated photo upload endpoint
- [x] Create photo replacement and removal endpoints
- [x] Restrict photo changes to authorized administrators (`fleet.manage_vehicle_photo`)
- [x] Enforce office-level access restrictions
- [x] Validate JPEG/PNG/WebP and file size on backend
- [x] Generate safe file names and prevent unsafe uploads
- [x] Add upload control to Vehicle Profile Overview
- [x] Add preview before upload and progress/error states
- [x] Display primary photo on Vehicle Profile
- [x] Display photo thumbnails on Vehicle Master List
- [x] Display placeholder when photo is missing
- [x] Make photo display responsive with correct aspect ratio
- [x] Audit photo uploads, replacements and removals
- [x] Test upload, replacement, deletion and unauthorized access (backend API tests)
- [ ] Include photo management in client UAT

# Phase 5 --- Driver and Assignment Module

-   [x] Driver CRUD API (no DELETE; deactivate instead)
-   [x] Driver list/profile UI (with driver photo upload, added 2026-10-12)
-   [x] Driver license fields
-   [x] Driver license attachments (PDF/JPEG/PNG/WebP, content-checked, 10 MB)
-   [x] Driver license expiration logic (valid / expiring ≤60 days / expired + list filter; alerts come in Phase 11)
-   [x] Vehicle assignment API
-   [x] Assign vehicle to office
-   [x] Assign accountable person
-   [x] Assign driver
-   [x] Assignment start/end dates
-   [x] Prevent conflicting current assignments (row-locked service + model check)
-   [x] Assignment history
-   [x] Reassignment workflow
-   [x] Display current assignment on vehicle profile
-   [x] Driver/assignment permissions (admins assign; Field Office Users view only)
-   [x] Tests (`test_drivers.py`, `test_assignments.py`)

**Phase gate:** Reassignment preserves previous assignment history
instead of overwriting it.

------------------------------------------------------------------------

# Phase 6 --- Trip Management

-   [x] Trip CRUD API (dispatch / complete / cancel; PATCH descriptive fields only; no DELETE)
-   [x] Trip-ticket/reference number (manual or auto `TT-YYYY-00001`)
-   [x] Vehicle selection
-   [x] Driver selection
-   [x] Passenger/requesting office
-   [x] Origin/destination (place search, route map, driving distance and time via LocationIQ (default, falls back to Geoapify when its limit is used up) or Geoapify; a "Use map" switch on the schedule/dispatch form turns it off for plain-text places + OpenStreetMap + React Leaflet; locations, coordinates, route and estimate saved on the trip; added 2026-10-12, needs GEOAPIFY_API_KEY, see README)
-   [x] Purpose
-   [x] Date/time out
-   [x] Date/time returned
-   [x] Starting odometer
-   [x] Ending odometer
-   [x] Calculate distance (DB generated column)
-   [x] Odometer validation (start ≥ vehicle odometer; end ≥ start and ≥ vehicle odometer; completion moves vehicle odometer)
-   [x] Vehicle-status dispatch validation (only Serviceable/In Use; one open trip per vehicle and per driver)
-   [x] Trip attachment (shared `AttachmentsMixin`)
-   [x] Trip list
-   [x] Trip detail
-   [x] Vehicle trip-history tab
-   [x] Trip filters (status cards, office, date range, search)
-   [x] Tests (`operations/test_trips.py`)

**Phase gate:** Trip completion updates/validates vehicle odometer
correctly and preserves history.

------------------------------------------------------------------------

# Phase 6B --- Trip Schedule TV Display

> Added 2026-10-08 at the client's request: a wall-mounted TV showing the
> trip schedule. Trips are currently created at dispatch time, so the
> schedule needs "scheduled" (future) trips first.

## Requirements

-   [ ] Confirm where the TV(s) will be (which office/s) and whose trips each screen shows
-   [ ] Confirm what is shown publicly (e.g. plate, driver, destination, time; passengers and purpose may be sensitive) — built default: plate, vehicle, driver (with photo), destination, purpose, times, status; passengers, remarks and odometer never sent
-   [ ] Confirm display hours, screen size/resolution and the device driving the TV (smart TV browser, mini PC, Chromecast)

## Trip scheduling

-   [x] "Scheduled" trip status: book a vehicle and driver for a future date/time (no odometer at booking; driver optional until dispatch, enforced by a DB check; added 2026-11-04)
-   [x] Prevent double-booking a vehicle or driver in overlapping schedules (no expected return = holds the rest of that day; "Dispatch now" is also blocked inside someone's booking; forms show booked vehicles/drivers as unavailable)
-   [x] Dispatch a scheduled trip (scheduled → dispatched) and cancel/reschedule it (dispatch only on the scheduled day, entering the current odometer; missed bookings must be rescheduled)
-   [x] Schedule calendar/list view in the Trips page (Scheduled status card, "Leaving today" board; Calendar/List toggle under the Scheduled card: month grid of bookings, missed ones in red, month in the URL; added 2026-10-27)
-   [x] Audit scheduling, rescheduling and cancellation

## Display

-   [x] Read-only schedule API for the display (on the road now, today's departures not yet gone, next 7 days; vehicle and driver photos), office-filtered (`GET /api/display/trips/?token=`; next 7 days)
-   [x] Display access without a staff login: dedicated read-only display account or revocable display token (`DisplayScreen` in Django admin; untick "is active" to revoke; staff open or copy the links from Trips → TV board)
-   [x] Full-screen TV route (e.g. `/display`) with DOLE branding, large high-contrast text, live date and clock
-   [x] Columns: time, vehicle/plate, driver, destination, status (active-trips board: content-sized cards — one trip is a wide featured card, a few stack full-width, four+ use a paged 2x2 grid; whole vehicle photo, driver photo, plate, destination that wraps, time out / expected back, progress bar; subordinate "Completed Today" strip; "Today" counts; next 7 days with a Tomorrow badge; cancelled trips never sent)
-   [x] Status shown in words and color: Scheduled, Departed/On trip, Returned, Delayed, Cancelled
-   [x] Highlight delayed departures and overdue returns (15-minute grace)
-   [x] Auto-refresh (about every 60 seconds) with no interaction needed
-   [x] Auto-page or scroll when the list is longer than the screen (6 rows per page, every 12 s, with a progress bar)
-   [x] "Connection lost / last updated" indicator if the network drops
-   [x] Motion that marks changes (2026-11-04): counters roll, trips whose status changed since the last refresh pulse a gold outline and carry "Just left" / "Just returned" / "New booking" for 10 minutes, new side-list rows slide in, progress bars move smoothly; stage drifts 2–3 px every 3 minutes against burn-in; soft logo-color glows drift slowly in the background (`TripDisplay.test.jsx`)
-   [ ] Readable at a distance at 1920×1080 landscape; avoid static elements that cause screen burn-in — fixed 1920×1080 stage scaled to any TV (Full HD, 4K, smaller); screenshot-checked at 1920×1080 and 1366×768; light panels on soft blue-gray; Inter font with system fallback; needs checking on the real TV
-   [x] Tests (display API scoping, token/permission, no sensitive fields) (`operations/test_schedule.py`)
-   [ ] UAT on the actual TV

**Phase gate:** The TV shows the correct, current schedule for its
office without anyone logging in, and exposes no data beyond what was
approved for public display.

------------------------------------------------------------------------

# Phase 7 --- Fuel Management

-   [x] Fuel CRUD API (no DELETE; edits audited)
-   [x] Fuel Purchase Order number
-   [x] Vehicle
-   [x] Driver
-   [x] Supplier
-   [x] Fuel type (must match a gasoline/diesel vehicle)
-   [x] Fuel quantity
-   [x] Unit price
-   [x] Total cost (computed from liters × price; receipt total accepted within ₱1)
-   [x] Odometer (newest fill-up moves the vehicle odometer forward)
-   [x] Receipt/reference
-   [x] Attachment (receipt/PO scans)
-   [x] Fuel list
-   [x] Vehicle fuel-history tab
-   [x] Fuel PO log view (same rows, `?has_po=true`; shows missing supporting documents)
-   [x] Date/office/vehicle filters (vehicle filter via API and the vehicle Fuel tab)
-   [x] Fuel cost calculation
-   [x] Distance-between-fueling calculation
-   [x] Estimated km/L calculation (full tank to full tank only; unusual-consumption flag below 75% of usual)
-   [x] Clearly label estimated fuel efficiency
-   [x] Detect invalid odometer sequence (must fit between previous and next fill-ups)
-   [x] Tests (`operations/test_fuel.py`; analytics also verified on MySQL)

**Phase gate:** Fuel history and PO report can reproduce required
existing spreadsheet information without duplicate data entry.

------------------------------------------------------------------------

# Phase 8 --- Maintenance Management

-   [x] Maintenance CRUD API (no DELETE; final records locked except remarks)
-   [x] Maintenance categories (editable reference list; deactivate, not delete)
-   [x] Multiple categories per event if required
-   [x] PR/reference number
-   [x] Supplier/service provider
-   [x] Description
-   [x] Odometer
-   [x] Labor cost
-   [x] Parts cost
-   [x] Total cost (DB-generated)
-   [x] Maintenance status (Scheduled → For inspection → In progress → Completed, or Cancelled; never backwards; In progress puts the vehicle Under Maintenance so it cannot be dispatched)
-   [x] Start/completion date
-   [x] Attachments (PR, job order, receipts)
-   [x] Vehicle maintenance-history tab (with that vehicle's preventive schedules)
-   [x] Maintenance schedule model (per vehicle + category; day and/or km interval)
-   [x] Next service date (typed, or suggested from the schedule on completion)
-   [x] Next service odometer
-   [x] Due-soon calculation (within 30 days / 500 km, configurable)
-   [x] Overdue calculation (either interval reached)
-   [x] Maintenance filters (status cards, office, category, date range, search; schedules by due status)
-   [x] Tests (`maintenance/test_maintenance.py`; due logic also verified on MySQL)

**Phase gate:** System identifies vehicles due/overdue for maintenance
by configured date/odometer rules.

------------------------------------------------------------------------

# Phase 9 --- Documents, LTO, GSIS and Renewals

-   [x] Document CRUD API (`/api/documents/`, no DELETE; cancel a wrong entry)
-   [x] Document types (LTO registration, OR, CR, GSIS insurance, insurance policy, deed, inspection, other)
-   [x] Reference number
-   [x] Issue date
-   [x] Expiration date (required for LTO, OR, GSIS and insurance)
-   [x] File upload (scanned PDF/image, content-checked; old scan deleted after replace)
-   [x] Vehicle documents tab (current documents with renew, plus all records)
-   [x] LTO records
-   [x] GSIS/insurance records
-   [x] OR/CR records
-   [x] Expiration validation (expiry not before issue, issue not in the future, renewal must expire later)
-   [x] 60-day alert (expiry band; in-app notifications come in Phase 11)
-   [x] 30-day alert (expiry band; notification in Phase 11)
-   [x] 15-day alert (expiry band; notification in Phase 11)
-   [x] 7-day alert (expiry band; notification in Phase 11)
-   [x] Expired status
-   [x] Renewal workflow (`POST /documents/{id}/renew/`, one current document per vehicle and type)
-   [x] Preserve previous document history (old version kept as Renewed; history timeline on the document page)
-   [x] Tests (`fleet/test_documents.py`, band edges checked against the SQL filter)

**Phase gate:** Renewing a document creates/preserves history and
expiration alerts are accurate.

------------------------------------------------------------------------

# Phase 10 --- RFID / Toll Module

-   [x] RFID provider/reference records (Easytrip / Autosweep / Other; `/api/rfid-accounts/`)
-   [x] Assign RFID account to vehicle (or leave unassigned in the motor pool)
-   [x] Mask sensitive information (account number shown as "•••• 1234" unless you can change the account, incl. in audit logs)
-   [x] Do not store plaintext third-party passwords (no password field at all; spec 5.8)
-   [x] Toll transaction CRUD (`/api/toll-transactions/`, no DELETE)
-   [x] Link toll transaction to trip where applicable (optional, must match the vehicle; the trip ticket shows a "Toll & RFID" card with its charges, and can record a toll linked to the trip)
-   [x] Credit/debit fields (a transaction is a load or a charge, never both; non-negative; one form can record a reload + several tolls from a trip as separate rows via `/toll-transactions/batch/`)
-   [x] Balance logic if required (live current balance = total loads (credit) − total charges (debit), shown on the account and lists; running balance per transaction)
-   [x] Toll transaction history (per account with running balance; per vehicle; global list)
-   [x] Vehicle RFID/toll tab (accounts + toll history)
-   [x] Filters (provider, office, status, unassigned; toll: kind, date range, account, vehicle; search)
-   [x] Tests (`operations/test_toll.py`; masking, credit/debit rules, running balance, scope, no delete)

**Phase gate:** RFID/toll history is usable without exposing sensitive
credentials.

------------------------------------------------------------------------

# Phase 11 --- Notifications

-   [x] Notification model/API (`/api/notifications/`: list own, `unread-count`, `read`, `read-all`, `dismiss`; recipients see only their own, no DELETE)
-   [x] Notification bell (unread count badge on the sidebar Notifications item; polls every 60s)
-   [x] Notification list (`/notifications` page: All / Unread, click opens the related record, per-item dismiss)
-   [x] Read/unread state (`read_at`; click-to-read; unread styled)
-   [x] Mark all as read
-   [x] Document-expiration notifications (bands 60/30/15/7/expired, reusing `fleet/documents.py`; LTO and GSIS/insurance get their own type)
-   [x] Driver-license notifications (expiring ≤60 days / expired, reusing `Driver.license_status`)
-   [x] Maintenance-due notifications (due soon, reusing `maintenance/service.py schedule_state`)
-   [x] Maintenance-overdue notifications
-   [x] Prevent duplicate threshold alerts (unique `(recipient, dedupe_key)` + `bulk_create(ignore_conflicts)`; a new band is a new key, so one alert per threshold)
-   [x] Scheduled notification generation (`manage.py run_notifications`, idempotent; hook up to cron/Task Scheduler at deployment — Phase 18)
-   [x] Role/office targeting (`recipients_for_office`: the office's users + anyone with `view_all_offices`)
-   [x] Tests (`notifications/test_notifications.py`: targeting, idempotency, per-band, API scope, 401)

**Phase gate:** Scheduled processing reliably generates the correct
alert once per configured event/threshold. — met; `run_notifications` is idempotent. Cron/Task Scheduler wiring deferred to deployment (Phase 18).

------------------------------------------------------------------------

# Phase 12 --- Dashboard and Analytics

One endpoint, `GET /api/dashboard/?office=&month=` (`backend/dashboard/views.py`), page `/dashboard` (`pages/Dashboard.jsx`).

-   [x] Total vehicle card (non-archived, same rule as the vehicle list)
-   [x] Serviceable count
-   [x] In-use count
-   [x] Under-maintenance count
-   [x] Unserviceable count (plus For repair)
-   [x] Vehicle-by-office visualization (ranked bars, links to `/vehicles?office=`)
-   [x] Upcoming renewal widget (LTO and GSIS/insurance: expired + within 60 days, soonest 5; reuses `fleet/documents.py` bands)
-   [x] Maintenance due widget (overdue / due soon from `schedule_state`, soonest 5)
-   [x] Driver license expiration widget (active drivers; expired / within 60 days)
-   [x] Recent activity (latest 10 across vehicles, documents, fuel, maintenance and trips; built from the office-scoped records because the audit log has no office — revisit with the Phase 14 audit API)
-   [x] Fuel summary (month cost, liters, fill-ups, vs previous month, 6-month trend)
-   [x] Maintenance cost summary (completed work in the month by record date, open count, 6-month trend)
-   [x] Utilization summary (completed trips, km, % of operable vehicles used, on a trip now, scheduled next 7 days, most-driven vehicles)
-   [x] Dashboard filters if required (office for multi-office users, month; kept in the URL)
-   [x] Cards link to filtered records (status, office, band/type, due, license status, month date range)
-   [x] Office-scoped dashboard data (`scope_to_offices`; `?office=` outside the user's scope returns zeros; sections omitted without the module's view permission)
-   [x] Performance optimization (one request, aggregate queries; test caps it at 40 queries; schedules still evaluated in Python like the schedule summary)
-   [x] Tests (`dashboard/test_dashboard.py`: figures, parity with the list summaries, scope, permissions, filters, 401, query count)

**Phase gate:** Dashboard figures match source records and user
permissions. — met; tests compare the dashboard with the list summary endpoints and check office scope and per-module permissions. Checked on the shared MySQL data.

------------------------------------------------------------------------

# Phase 13 --- Reports and Export

-   [x] Vehicle Master List report
-   [x] Vehicle History report (`vehicle-history`: assignments, documents, trips, fuel, maintenance in date order)
-   [x] Assignment History report
-   [x] Fuel Consumption report (est. km/L from full-tank windows only, labelled as an estimate)
-   [x] Fuel PO report (fuel records with a PO number; no duplicate PO data)
-   [x] Fuel Cost report (group by office, vehicle, month or fuel type)
-   [x] Maintenance History report
-   [x] Maintenance Expense report (completed jobs only; group by office, vehicle, category or month)
-   [x] Trip History report
-   [x] Vehicle Utilization report (days with a completed trip / days in period)
-   [x] LTO expiration report
-   [x] GSIS/insurance expiration report
-   [x] Driver assignment report
-   [x] Driver license expiration report
-   [x] Vehicle status report (serviceable / unserviceable, counts per status)
-   [x] Office Fleet Summary
-   [x] Date-range filters (default this month for period reports)
-   [x] Office filters
-   [x] Vehicle filters
-   [x] Driver/status filters
-   [x] Print view (`/reports/:slug/print`, A4 landscape, opens the print dialog)
-   [x] PDF export (reportlab, DOLE header and logo, repeated header row, page footer)
-   [x] Excel/CSV export (openpyxl with numeric cells and formats; CSV UTF-8 with BOM); exports are audit-logged
-   [x] VEHICLE RECORD export: the system's records in the old workbook layout (RO3 list, one sheet per plate, PO log); Vehicles page button and Data Import page ("Form with current data"), `/api/export/vehicle-record/`, office-scoped, per-section permissions, masked RFID numbers, audit-logged (`dataimport/export.py`, `test_export.py`)
-   [x] Verify report totals (`reports/test_reports.py` compares totals with the fuel, maintenance, trip and vehicle summaries; every report and format tested)

**Phase gate:** Client verifies that required official reports contain
correct records and totals. — pending client review; totals are checked against the list summaries in tests and the PDF layout was checked on the shared MySQL data.

------------------------------------------------------------------------

# Phase 14 --- Audit Trail

-   [x] Create audit service/middleware/signals strategy (`audit.services.log()` called explicitly from views)
-   [x] Vehicle creation/update/archive logs
-   [x] Assignment change logs
-   [x] Odometer correction logs (lowering odometer needs `fleet.correct_odometer`)
-   [x] Fuel change logs (create, edit with field diff, odometer updates)
-   [x] Maintenance change logs (create, edit diff, each status change with side effects)
-   [x] Document change logs (create, edit diff, renew, cancel, file replace)
-   [x] User/role change logs
-   [x] Audit-log API (`/api/audit-logs/`, read-only; filters by action, record type/ID, user, date range, search; `/facets/` for the dropdowns)
-   [x] Audit-log UI (`/audit-logs`: filters in the URL, links to the changed record, detail modal with a before/after table)
-   [x] Admin-only/restricted permissions (`audit.view_auditlog` is System Administrator only; Fleet Admin, Field Office User and Viewer get 403)
-   [x] Before/after values for critical changes (`{'field': [old, new]}` from `diff()`; creations store an `after` snapshot; RFID numbers masked)
-   [x] Prevent modification/deletion by normal users (no write API; admin read-only; `AuditLog.save()` refuses updates and `delete()` raises)
-   [x] Tests (`audit/test_audit.py`: fuel/maintenance/document diffs, filters, facets, role access, no writes, append-only model, 401)

Deferred: the dashboard's "Recent activity" still reads the office-scoped records, because the audit log has no office field. Adding one would let field users see their own office's history.

**Phase gate:** Critical changes can be traced to user, timestamp,
entity, and before/after values. — met; every entry stores user (plus username snapshot), timestamp, entity type/ID, IP and browser, and edits store field-level before/after (tested for fuel, maintenance and documents).

------------------------------------------------------------------------

# Phase 15 --- Excel Data Migration

Approach: the migration uses a **standard import workbook** (`manage.py import_workbook --template`).
RO3's source workbook (`DATA/VEHICLE RECORD.xlsx`, git-ignored) is converted into it automatically with
`import_workbook --convert` (`dataimport/legacy.py`, `test_legacy.py`). The values the old sheets lack now have
columns in the old workbook itself: `import_workbook --prepare` writes `DATA/VEHICLE RECORD (to fill).xlsx` with
FUEL TYPE / VEHICLE TYPE / START DATE / LTO EXPIRY (RO3), LICENSE TYPE (drivers), PRICE/L (fill-ups), TIME OUT / IN
and ODO OUT / IN (trip log) and UNIT PRICE (PO log), formatted like the existing columns. Dry run so far (throwaway database):
maintenance 46 and toll 601 rows clean. Waiting on staff to fill 253 prices, 19 start dates, 27 license types,
17 LTO expiry dates, 4 fuel types, and trip times for the trips worth importing.

-   [x] Make backup copy of source workbook (every run copies the input to `backend/import_runs/` before reading)
-   [x] Create Excel-to-database field mapping (`docs/MIGRATION.md`: old sheet → template → DB field; applied by `import_workbook --convert`)
-   [x] Normalize office names (code, name ignoring case/punctuation/"DOLE", or an alias on the Offices sheet)
-   [x] Normalize vehicle names (plates uppercased; `SAB 1234` / `SAB-1234` / `sab1234` match; identifiers uppercased, blank → NULL)
-   [x] Normalize driver/accountable-person names (spaces/case/punctuation ignored; drivers matched by license then name; ambiguous → warning, never a duplicate silently)
-   [x] Identify duplicate plate numbers (within the sheet and against the system)
-   [x] Identify malformed dates (several formats accepted; anything else fails the row)
-   [x] Identify missing required fields (missing column skips the sheet; missing cell fails the row)
-   [x] Build import command/script (`manage.py import_workbook`, dry run unless `--commit`, `--user` required to commit; blank VEHICLE RECORD form, in RO3's own layout and format with the added columns, downloadable in the app: Administration → Data Import, `accounts.import_data`; standard workbook as a secondary link)
-   [ ] Import vehicle master records (21 converted; FUEL TYPE column added for the 4 still blank; staging import pending)
-   [ ] Import assignments (19 converted; START DATE column added, to fill)
-   [ ] Import maintenance history (46 converted, clean in the dry run; staging import pending)
-   [ ] Import fuel history (253 converted; PRICE/L column added next to FUEL LITERS, to fill)
-   [ ] Import Fuel PO log (Sheet20 is read and merged into the fill-ups, UNIT PRICE column added; the sheet is still empty)
-   [ ] Import trip/toll data where reliable (601 toll rows clean; trips convert from log lines with TIME OUT / IN and ODO OUT / IN, to fill)
-   [ ] Import LTO/GSIS information (GSIS 16 clean; LTO EXPIRY column added, to fill)
-   [x] Produce import warnings (Issues sheet: sheet, Excel row, level, field, message, value, reviewer column)
-   [x] Produce import summary (created / updated / skipped / failed / warnings per sheet, on screen and in the report; audit entry on commit)
-   [ ] Perform dry run on staging (converted workbook dry-run on a throwaway SQLite copy with the real offices; staging run after the blanks are filled)
-   [ ] Reconcile counts against Excel (procedure in `docs/MIGRATION.md` step 7)
-   [ ] Manually review flagged rows
-   [ ] Obtain client validation of migrated records

**Phase gate:** Staging migration reconciles with the source workbook
and no production data is silently overwritten. — not yet: the "never overwrite" half is built and tested (existing values kept and reported, re-runs create nothing); reconciliation waits for the real workbook.

------------------------------------------------------------------------

# Phase 16 --- Security Hardening

Reference: `docs/SECURITY.md` (production settings, pre-release checks). Tests: `config/test_security.py`.

-   [x] HTTPS configuration (TLS at Coolify's proxy; Django redirect, proxy SSL header, HSTS 1 year; subdomains/preload off on purpose)
-   [x] Production CORS allowlist (own origin only, empty by default when `DEBUG=False`, never a wildcard)
-   [x] CSRF configuration (token on every write, trusted origins, SameSite=Lax)
-   [x] Secure cookie/token configuration (session HttpOnly + Secure + Lax, 8 h; TV board token random 64 chars, revocable)
-   [x] Password policy (min 10 chars, common/numeric/similarity checks, forced change for new accounts)
-   [x] Rate-limit sensitive endpoints (login 10/min per IP + 20 failures/hour per username; change-password 10/hour; exports 30/min; display and maps 120/min; shared DB cache in production)
-   [x] File extension/MIME validation (PDF header / Pillow decode for documents and attachments, image type must match the extension; photos re-named from their real format)
-   [x] File size limits (`ATTACHMENT_MAX_BYTES` 10 MB, `VEHICLE_PHOTO_MAX_BYTES` 5 MB, nginx 15 MB)
-   [x] Safe upload paths/file names
-   [x] Authorization review for every endpoint (schema-driven tests: 401 logged out, refused without a role, Viewer read-only, pending password change blocked, DELETE only for files; API docs need login)
-   [x] Office-scoping penetration tests (Field Office User vs. another office on every scoped endpoint, action and file; object lookup now precedes input validation in trip/maintenance/document actions)
-   [ ] Remove secrets from repository/history (no `.env` or keys ever committed, but `DATA/VEHICLE RECORD.xlsx` with 13 Easytrip USERNAME/PW pairs is in history (`54283df`, removed in `732f354`): change those passwords; optional history purge in `docs/SECURITY.md`)
-   [x] Production `DEBUG=False` (compose; app refuses to start with a weak `SECRET_KEY` when not in debug)
-   [x] Secure headers (Django: frame DENY, nosniff, referrer, COOP, HSTS; nginx: same + CSP and Permissions-Policy for the SPA)
-   [x] Logging does not expose credentials/tokens (redaction filter on the console log, `sensitive_post_parameters`, audit masks RFID and never stores passwords)
-   [x] Uploaded documents and attachments behind login, permission and office (`config/media.py`, nginx `X-Accel-Redirect`); photos public for the TV board
-   [ ] Database least-privilege account (grants written in `docs/SECURITY.md`; to be applied on the production MySQL)
-   [x] Backup encryption/access policy where applicable (`docs/SECURITY.md`; scheduling the encrypted backup is a deployment task)
-   [x] Dependency vulnerability review (pip-audit clean; npm audit: zod upgraded to 4.6.7, now 0)

**Phase gate:** Security checklist and permission tests pass before
production deployment. — permission tests pass; not met until the Easytrip passwords are changed and the
least-privilege database account is in place.

------------------------------------------------------------------------

# Phase 17 --- QA and User Acceptance Testing

Results, defects fixed and UAT scenarios: `docs/QA.md`. Demo/QA data: `manage.py seed_demo` (SQLite only).

## Functional QA

-   [x] Test all CRUD workflows (per-module backend tests; browser walkthrough of every page on demo data)
-   [x] Test filters/search/pagination (backend filter tests; DataTable paging tests; browser)
-   [x] Test validation messages (backend serializer tests; frontend field-error and API-message tests)
-   [x] Test uploads/downloads (content checks, protected files 200/401/403/404, CSV/Excel/PDF per report, VEHICLE RECORD workbook)
-   [x] Test notifications (generation/dedupe tests; list query count fixed)
-   [x] Test reports (every report runs and exports; Driver Assignment with one driver was a 500, fixed)
-   [x] Test audit logs (append-only and filter tests; browser)

## Role QA

-   [x] System Administrator (browser + tests)
-   [x] Fleet Administrator (tests: writes allowed, no users/audit)
-   [x] Field Office User (browser: Tarlac only, 404 for other offices, 403 for admin pages)
-   [x] Viewer (browser: read-only; direct API write answers 403)
-   [x] Unauthorized user (every endpoint: 401 logged out, refused without a role; route-guard tests)

## Technical QA

-   [x] Backend automated tests (226 passing)
-   [x] Frontend tests (Vitest + Testing Library, 20 passing; `npm test`)
-   [x] API integration tests (DRF client tests per endpoint, schema-wide security and query-count tests)
-   [ ] Browser testing (Chrome done; Edge/Firefox during UAT)
-   [x] Responsive testing (every page at 390 px; sideways scrolling fixed on dashboard, vehicle profile, documents, fuel)
-   [x] Performance testing (300 vehicles / 12k trips: lists ≤ 180 ms, dashboard 129 ms; Excel export 35 s → 2.6 s, VEHICLE RECORD 95 s → 20 s; N+1 fixed in fuel and notifications)
-   [ ] Backup/restore test (needs staging MySQL and the Phase 18 backup job; procedure in `docs/SECURITY.md`)
-   [ ] Error/recovery testing (partial: server/network/rate-limit messages, session expiry, atomic writes; database outage and restart not yet)

## UAT

-   [x] Prepare UAT scenarios (`docs/QA.md`: 18 scenarios, issue log, sign-off sheet)
-   [ ] Import realistic staging data (waits on the Phase 15 blanks being filled)
-   [ ] Conduct client UAT
-   [ ] Record issues (issue log template in `docs/QA.md`)
-   [ ] Prioritize defects (severity scale in `docs/QA.md`)
-   [ ] Fix blocking/critical defects
-   [ ] Retest
-   [ ] Obtain UAT sign-off

------------------------------------------------------------------------

# Phase 17A --- Vehicle Requests (Requester Portal)

Added 2026-11-04, outside the original spec. Employees request a vehicle; fleet staff approve it, and approving creates
a SCHEDULED trip, so the existing trip lifecycle, odometer rules and TV board all apply unchanged. Numbered 17A so
the deployment phases keep their numbers.

## Decisions (made 2026-11-04)

-   [x] Approval chain: Fleet Administrator only (no supervisor step)
-   [x] Accounts: one per employee (role Requester, created by the System Administrator)
-   [x] Availability: requesters see only the outcome, not the fleet schedule
-   [x] Driver: optional at approval, required at dispatch (same rule as scheduling)

## Backend

-   [x] `Requester` role in `seed_reference` (own requests, notifications and map search only; no fleet, fuel, RFID, reports or audit access). Fleet Administrator gets `approve_vehiclerequest`
-   [x] `VehicleRequest` model: requester, office, purpose, needed/return date-time, origin, destination, passengers, remarks, map route (shared `RoutePlan` base with Trip), linked trip, decision note; DB checks (return after needed, approved has a trip)
-   [x] Status flow in `operations/requests.py`: PENDING → APPROVED / DECLINED (reason required) / CANCELLED (requester, while pending or approved before dispatch; cancels the trip too); afterwards `progress` follows the trip (dispatched, completed)
-   [x] Approve = pick vehicle (driver optional), books a SCHEDULED trip via `operations/trips.py` (locks vehicle row), copying route, passengers and requesting office
-   [x] Conflict checks on approve: the trip booking rules (overlap, unserviceable/disposed, future time, driver license); nothing saved on failure
-   [x] Approve: the vehicle must belong to the requesting office (`approve()` refuses others; the approve form lists only that office's vehicles). Same for the driver when one is chosen (2026-11-05)
-   [x] API `/api/vehicle-requests/`: requester sees only own (others 404), approvers office-scoped; `progress`/`mine` filters; `summary/`; actions via `require(...)`; no DELETE
-   [x] Travel order attachment (`AttachmentsMixin`; `config/media.py` uses the model's `visible_to()`, so another requester gets 404)
-   [x] Notifications: new request (approvers of that office), approved, declined, dispatched (requester); `VEHICLE_REQUEST` type links to the request
-   [x] Audit logging on submit/approve/decline/cancel
-   [x] Tests: `operations/test_requests.py` (flow, permissions, scoping, conflicts, attachment privacy); `test_security` `far` fixture; `seed_demo` requests so `test_performance` covers the list (that test still fails on the unrelated maintenance-history report, see Phase 17)

## Frontend

-   [x] Requester layout/nav (Vehicle requests, Notifications, Password; lands on /requests, no dashboard)
-   [x] Request list: status cards (Pending / Approved / On trip / Completed / Declined / Cancelled) + table with search; "My vehicle requests" for requesters, "Vehicle requests" queue for approvers
-   [x] New Request form with place search and route estimate (maps allowed for requesters)
-   [x] Request detail: progress timeline, booked vehicle/plate/photo, driver name/contact (or "to be assigned"), decline reason, cancel button, route map, travel order attachments
-   [x] Approve dialog (vehicle + optional driver, booked/unavailable ones disabled, conflict warnings) and Decline (reason)
-   [x] Dashboard banner "N vehicle requests waiting for approval" for approvers (now a tile in the Phase 17B "Today" section)
-   [ ] Mobile layout check at 390 px (layouts reuse the responsive patterns; not yet checked in a browser)
-   [x] Vitest coverage: requester nav, request detail (requester/approver/declined), request list

## Docs

-   [x] `docs/ERD.md`, `README.md` (endpoints, role), `docs/QA.md` (UAT U19–U23), `seed_demo` `qa_requester` login, `CLAUDE.md`

------------------------------------------------------------------------

# Phase 17B --- Fleet Desk (Fleet Administrator dashboard)

Added 2026-11-04. The dashboard opens with what needs action today, for everyone with trip access (Fleet Administrator,
Field Office User, System Administrator); the rest of the Phase 12 dashboard is unchanged below it.

-   [x] `/api/dashboard/` `dispatch` section: requests to approve (approvers only), trips without a driver, to dispatch today, overdue returns, RFID accounts below `RFID_LOW_BALANCE` (default ₱500); office filter applies
-   [x] Shared rules in `operations/trips.py` (`NEEDS_DRIVER`, `overdue_q`: past the expected return, or still out after the departure day) and `operations/toll.py` (`low_balance`), so the counts match the lists
-   [x] List filters: `/trips/?needs_driver=true&overdue=true`, `/rfid-accounts/?low_balance=true`, with filter chips on the Trips and RFID pages
-   [x] Dashboard "Today": action tiles linking to the filtered lists, then the Trips page's "Leaving today" (dispatch with odometer) and "Out right now" (record return) boards; replaces the pending-requests banner
-   [x] Approve form shows booked vehicles/drivers (already built in 17A)
-   [x] Tests: `dashboard/test_dashboard.py::test_dispatch_counts_match_the_lists`, `src/pages/Dashboard.test.jsx`
-   [ ] Mobile layout check at 390 px in a browser

------------------------------------------------------------------------

# Phase 17C --- Requesting division on trips

Added 2026-11-05. Trips can record which division asked for them (optional: other offices have no divisions).

-   [x] `Trip.requesting_division` (IMSD, TSSD-1, TSSD-2, MALSU); optional on `/trips/` (dispatch) and `/trips/schedule/` (blank = no division); editable on PATCH (audited); `?requesting_division=` filter
-   [x] Trip History report: Division column (CSV/Excel/PDF)
-   [x] Schedule / Dispatch form: optional "Requesting division" select in Other details; trip detail shows it and the edit form can set it
-   [x] Division chip on the Trips page (table, Leaving today, Out right now) and the TV board (trip cards, Next 7 Days, Returned Today, next trip); `requesting_division` added to `DisplayTripSerializer` (not sensitive)
-   [x] Tests: `operations/test_trips.py::test_requesting_division_optional_and_editable`; existing payloads updated
-   [ ] Vehicle requests: approving a request books the trip without a division (requests don't ask for one yet); set it on the trip afterwards

------------------------------------------------------------------------

# Phase 17D --- Delete test data (System Administrator)

Added 2026-11-05. Clear records entered while testing before go-live. Day-to-day records are still never deleted (cancel/archive).

-   [x] `accounts.purge_test_data` permission (migration `accounts.0005`; System Administrator only via `seed_reference`)
-   [x] `dataimport/purge.py`: groups (trips + requests, fuel, tolls, RFID accounts, maintenance, assignments, documents, notifications, odometer reset); deletes their attachments and stored files; vehicles left In Use / Under Maintenance go back to Serviceable; maintenance schedules restart. Vehicles, drivers, offices, users, categories, display screens are kept; audit log untouched
-   [x] `/api/admin/purge/`: GET counts, POST `{groups, confirm: "DELETE"}` (POST, not DELETE, so the no-DELETE-endpoint rule holds); audit-logged with row counts
-   [x] UI: Admin > Delete test data (checkboxes with counts, type DELETE to confirm)
-   [x] Tests: `dataimport/test_purge.py` (role check, confirmation, vehicles/drivers kept, audit entry)
-   [ ] No automatic backup: run `deploy/backup.sh` (or `mysqldump`) before purging

------------------------------------------------------------------------

# Phase 17E --- Toll on trip return

Added 2026-11-05. The return form carries the trip's reload and toll lines; optional, since many trips use no expressway.

-   [x] `/trips/{id}/complete/` takes optional `toll: {account, items}`; validated like `/toll-transactions/batch/` (shared `toll_payloads`/`record_tolls` in `operations/views.py`), saved at the return time and linked to the trip, in one transaction with the return (a bad toll line saves neither); needs `operations.add_tolltransaction`
-   [x] Record return (trip page and Trips list): Toll (optional) section with the RFID account (the vehicle's own picked automatically), reload and toll lines (shared `TollLines` from `TollForm.jsx`); blank lines send no toll; hidden without the toll permission
-   [x] Toll form opened from a trip or vehicle also auto-picks that vehicle's active account; both forms show the current balance and the balance after the entry (red with a hint when the tolls exceed the load)
-   [x] Tests: `operations/test_toll.py::test_return_records_the_trip_tolls_in_the_same_save`, `::test_return_toll_needs_toll_permission`; `src/pages/trips/CompleteForm.test.jsx`


------------------------------------------------------------------------

# Phase 17F --- Office-limited administrators

Added 2026-11-05. A Fleet Administrator (or Viewer) assigned to an office sees only that office's vehicles and records.

-   [x] `accounts.permissions.sees_all_offices()`: `view_all_offices` applies only while the user has no office assigned (superusers always see all); cached per request
-   [x] Used by `scope_to_offices`, `check_office_access`, `/auth/me/` `view_all_offices`, dashboard RFID, display screens, RFID accounts, request visibility/submit, and office notification recipients
-   [x] Users page hint: leave offices empty for all offices, or select offices to limit the user
-   [x] Test: `fleet/test_vehicles.py::test_fleet_administrator_assigned_to_an_office_sees_only_that_office`
-   [ ] Existing all-office users who had offices ticked "for information" are now limited to them; clear their offices on the Users page to restore all-office access

------------------------------------------------------------------------

# Phase 17G --- Requester home

Added 2026-11-05. The requester's Vehicle requests page was the approver's table with seven mostly-zero cards.

-   [x] `pages/requests/MyRequests.jsx` (requesters; approvers keep the queue in `RequestList.jsx`): greeting with a large Request a vehicle button; empty state for first-time requesters
-   [x] Current request card(s) (pending/approved/on trip, soonest first): plain date ("Tomorrow · 8:00 AM"), destination and purpose, the booked vehicle (photo, plate, model, driver and contact) or a waiting note, and a Submitted → Approved → On trip → Completed progress bar
-   [x] All requests as a compact list with status tabs shown only for statuses that have requests
-   [x] Tests: `src/pages/requests/requests.test.jsx` (current card, tabs, empty state, approver queue unchanged)
-   [ ] Loads the latest 100 requests (no paging); cancel stays on the request page
-   [ ] Not yet checked on a 390 px phone

------------------------------------------------------------------------

# Phase 17H --- Searchable dropdowns

Added 2026-11-05. Every dropdown can be searched by typing (vehicles, drivers, offices, accounts, filters).

-   [x] `components/Select.jsx`: drop-in for `<select>` (same props, `<option>`/`<optgroup>` children; works with react-hook-form `register` and controlled `value`/`onChange`); hidden native select keeps the value; list opens in a popover (top layer, not clipped by modals or cards) with a search box, keyboard (arrows, Enter, Esc, type to search), disabled options skipped
-   [x] All 60 dropdowns in 25 pages switched to `<Select>`
-   [x] Tests: `src/components/Select.test.jsx`
-   [ ] Not yet checked in a browser (Chrome/Edge/Firefox) and on a 390 px phone
-   [x] List tables show 8 rows per page (`PAGE_SIZE` in `src/api.js`: `useList` adds `page_size=8` to any paged request; `DataTable` pages by it). The API default stays 25 for other callers
-   [x] Fix: Next page jumped back to page 1 on the URL-filtered lists (the search debounce re-ran on every URL change and reset the page). Shared `useSetParam` in `components/filters.jsx` ignores unchanged values; used by all 9 list pages. Test: `src/pages/vehicles/VehicleList.test.jsx`

------------------------------------------------------------------------

# Phase 17I --- RFID starting balance

Added 2026-11-05. Cards that already hold a balance when they are first encoded.

-   [x] `POST /rfid-accounts/` optional `opening_balance`: `toll.opening_balance()` records it as an "Opening balance" load (credit) at creation, in the same transaction, so live/running balances, low-balance alerts and reports include it; audit entry shows the amount
-   [x] Needs an assigned vehicle (toll transactions belong to a vehicle); otherwise 400 and the account is not created. Negative or non-numeric amounts refused
-   [x] Add account form: "Starting balance (₱)" (new accounts only; disabled until a vehicle is chosen)
-   [x] Test: `operations/test_toll.py::test_new_account_can_start_with_an_existing_balance`
-   [ ] Existing accounts: add the balance as a load (Record toll → Reload, reference "Opening balance")
------------------------------------------------------------------------

# Phase 18 --- Deployment

Runbook: `docs/DEPLOYMENT.md` (sections 1-11). Everything below that needs the real server is still open: no server,
domain or Docker host was available while building. The repository side is ready and tested locally (2026-10-29).

-   [ ] Provision production server/environment (spec and Coolify install in DEPLOYMENT.md §1)
-   [ ] Install/configure MySQL (Coolify MySQL 8, `vims` utf8mb4, least-privilege `vrs_app`: §2)
-   [ ] Configure Django production environment (docker-compose.yaml for Coolify written 2026-10-27, not yet deployed or built; env vars listed in §3)
-   [ ] Configure React production build (docker-compose.yaml for Coolify written 2026-10-27, not yet deployed or built)
-   [ ] Configure application server (gunicorn in the backend container; docker-compose.yaml written 2026-10-27, not yet deployed or built)
-   [ ] Configure reverse proxy (nginx `web` container behind Coolify's Traefik; docker-compose.yaml written 2026-10-27, not yet deployed or built)
-   [ ] Configure domain/DNS (A record request: §4)
-   [ ] Configure HTTPS (Coolify Let's Encrypt; HTTPS redirect + HSTS in Django: §4)
-   [ ] Configure persistent media storage (`media` named volume, written 2026-10-27, not yet deployed or built: §5)
-   [ ] Configure scheduled jobs (Coolify Scheduled Tasks `run_notifications` 06:00 and `clearsessions`: §7)
-   [ ] Configure backups (`deploy/backup.sh` + `restore.sh`: gpg AES-256, 30 days, off-site hook, heartbeat; pipeline tested with a stand-in docker/gpg, real gpg encryption not yet run: §8)
-   [ ] Configure log rotation (compose `json-file` 5 x 10 MB per container; logrotate entry for the backup log: §9)
-   [ ] Configure health monitoring (`/api/health/` checks DB + media volume, compose healthchecks, `web` waits for a healthy backend; verified against a DEBUG=False server; external uptime monitor still to set up: §10)
-   [ ] Create initial administrator (`manage.py create_admin`: System Administrator, one-time password, must change at first login; tested in `config/test_deploy.py`: §6)
-   [ ] Run production migrations (automatic on every backend start)
-   [ ] Run approved data migration (waits on client approval of the import review; container steps in §11; Dockerfile now creates a writable `import_runs/`)
-   [ ] Smoke-test production (`deploy/smoke_test.py`, read-only; passes against the local QA stack except the nginx-only headers)
-   [ ] Verify permissions (smoke test `--viewer` + per-role checks by hand: §11)
-   [ ] Verify reports (smoke test exports CSV/Excel/PDF; totals against the old workbook with the client: §11)
-   [ ] Verify file uploads (smoke test reads existing photo/document; upload by hand: §11)
-   [ ] Verify backups (`restore.sh --check` + quarterly staging restore: §8)

**Phase gate:** Production smoke test and client deployment acceptance
pass.

------------------------------------------------------------------------

# Phase 19 --- Documentation and Turnover

-   [ ] System architecture documentation
-   [ ] ERD
-   [ ] API documentation
-   [ ] Deployment guide
-   [ ] Backup/restore guide
-   [ ] Administrator manual
-   [ ] User manual
-   [ ] Data migration documentation
-   [ ] Troubleshooting guide
-   [ ] Source-code repository handover
-   [ ] Environment variable template
-   [ ] Conduct administrator training
-   [ ] Conduct end-user training
-   [ ] Record known limitations
-   [ ] Define support/maintenance process

------------------------------------------------------------------------

# Phase 20 --- Post-Deployment

-   [ ] Monitor application errors
-   [ ] Review user feedback
-   [ ] Review performance
-   [ ] Verify scheduled backups
-   [ ] Verify notification jobs
-   [ ] Patch critical bugs
-   [ ] Review audit logs
-   [ ] Review security updates
-   [ ] Plan Phase 2 enhancements

------------------------------------------------------------------------

# Suggested MVP Cut

For an initial usable release, prioritize: - \[ \] Authentication/RBAC -
\[ \] Offices - \[ \] Vehicle Master Records - \[ \] Vehicle Profile -
\[ \] Drivers and Assignments - \[ \] Trips - \[ \] Fuel / Fuel PO - \[
\] Maintenance - \[ \] LTO/GSIS/Documents - \[ \] Basic Notifications -
\[ \] Core Reports - \[ \] Audit Trail - \[ \] Excel Migration - \[ \]
Backup/Restore

Possible later enhancements: - \[ \] Approval workflows - \[ \] QR code
per vehicle - \[ \] Mobile/PWA workflow - \[ \] Email notifications - \[
\] SMS notifications - \[ \] GPS/telematics integration - \[ \]
Automated RFID integration - \[ \] Advanced fuel anomaly detection - \[
\] Maintenance forecasting - \[ \] Digital trip request/approval - \[ \]
Procurement/accounting integrations

------------------------------------------------------------------------

# Team-of-Two Suggested Work Split

## Developer A --- Backend / Data Lead

-   Django models and migrations
-   DRF APIs
-   Authentication/permissions
-   MySQL
-   Business rules
-   Reports backend
-   Excel migration
-   Automated backend tests
-   Deployment/backend configuration

## Developer B --- Frontend / UX Lead

-   React structure
-   Navigation/layout
-   Forms
-   Data tables
-   Vehicle profile
-   Dashboard
-   Filters/search
-   Reports UI
-   Notification UI
-   Responsive/accessibility QA

## Shared Responsibilities

-   Requirements
-   ERD/API contract
-   Git pull requests/reviews
-   Integration testing
-   UAT
-   Security review
-   Documentation
-   Deployment

Do not let the frontend and backend developers work from assumptions.
Agree on model fields, endpoint contracts, request/response shapes and
validation rules before implementing each module.

------------------------------------------------------------------------

# Per-Feature Definition of Done

Before checking a feature as complete: - \[ \] Database/model changes
are migrated - \[ \] Backend business validation exists - \[ \]
Server-side permissions exist - \[ \] API works - \[ \] API errors are
consistent - \[ \] React uses the real API - \[ \] Loading state
exists - \[ \] Empty state exists - \[ \] Error state exists - \[ \]
Form validation exists - \[ \] Responsive layout checked - \[ \] Audit
logging added where required - \[ \] Automated tests pass - \[ \] Manual
Admin test completed - \[ \] Manual restricted-user test completed - \[
\] Documentation updated - \[ \] Code reviewed and merged through Git
