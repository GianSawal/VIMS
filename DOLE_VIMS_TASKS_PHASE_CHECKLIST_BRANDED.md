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
-   [ ] Review the existing Vehicle Record Excel workbook
-   [ ] Document all current Excel columns and meanings
-   [ ] Identify duplicate/inconsistent source data
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
-   [x] Origin/destination
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
-   [ ] Confirm what is shown publicly (e.g. plate, driver, destination, time; passengers and purpose may be sensitive) — built default: plate, vehicle, driver, destination, times, status; passengers/purpose/odometer never sent
-   [ ] Confirm display hours, screen size/resolution and the device driving the TV (smart TV browser, mini PC, Chromecast)

## Trip scheduling

-   [x] "Scheduled" trip status: book a vehicle and driver for a future date/time (no odometer at booking)
-   [x] Prevent double-booking a vehicle or driver in overlapping schedules (no expected return = holds the rest of that day; "Dispatch now" is also blocked inside someone's booking; forms show booked vehicles/drivers as unavailable)
-   [x] Dispatch a scheduled trip (scheduled → dispatched) and cancel/reschedule it (dispatch only on the scheduled day, entering the current odometer; missed bookings must be rescheduled)
-   [x] Schedule calendar/list view in the Trips page (Scheduled status card, "Leaving today" board; calendar view not built)
-   [x] Audit scheduling, rescheduling and cancellation

## Display

-   [x] Read-only schedule API for the display (today's and upcoming trips, out now, returned today), office-filtered (`GET /api/display/trips/?token=`; next 7 days)
-   [x] Display access without a staff login: dedicated read-only display account or revocable display token (`DisplayScreen` in Django admin; untick "is active" to revoke)
-   [x] Full-screen TV route (e.g. `/display`) with DOLE branding, large high-contrast text, live date and clock
-   [x] Columns: time, vehicle/plate, driver, destination, status
-   [x] Status shown in words and color: Scheduled, Departed/On trip, Returned, Delayed, Cancelled
-   [x] Highlight delayed departures and overdue returns (15-minute grace)
-   [x] Auto-refresh (about every 60 seconds) with no interaction needed
-   [x] Auto-page or scroll when the list is longer than the screen (8 rows per page, every 12 s)
-   [x] "Connection lost / last updated" indicator if the network drops
-   [ ] Readable at a distance at 1920×1080 landscape; avoid static elements that cause screen burn-in — built for 1080p with a dark theme; needs checking on the real TV
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

-   [ ] Document CRUD API
-   [ ] Document types
-   [ ] Reference number
-   [ ] Issue date
-   [ ] Expiration date
-   [ ] File upload
-   [ ] Vehicle documents tab
-   [ ] LTO records
-   [ ] GSIS/insurance records
-   [ ] OR/CR records
-   [ ] Expiration validation
-   [ ] 60-day alert
-   [ ] 30-day alert
-   [ ] 15-day alert
-   [ ] 7-day alert
-   [ ] Expired status
-   [ ] Renewal workflow
-   [ ] Preserve previous document history
-   [ ] Tests

**Phase gate:** Renewing a document creates/preserves history and
expiration alerts are accurate.

------------------------------------------------------------------------

# Phase 10 --- RFID / Toll Module

-   [ ] RFID provider/reference records
-   [ ] Assign RFID account to vehicle
-   [ ] Mask sensitive information
-   [ ] Do not store plaintext third-party passwords
-   [ ] Toll transaction CRUD
-   [ ] Link toll transaction to trip where applicable
-   [ ] Credit/debit fields
-   [ ] Balance logic if required
-   [ ] Toll transaction history
-   [ ] Vehicle RFID/toll tab
-   [ ] Filters
-   [ ] Tests

**Phase gate:** RFID/toll history is usable without exposing sensitive
credentials.

------------------------------------------------------------------------

# Phase 11 --- Notifications

-   [ ] Notification model/API
-   [ ] Notification bell
-   [ ] Notification list
-   [ ] Read/unread state
-   [ ] Mark all as read
-   [ ] Document-expiration notifications
-   [ ] Driver-license notifications
-   [ ] Maintenance-due notifications
-   [ ] Maintenance-overdue notifications
-   [ ] Prevent duplicate threshold alerts
-   [ ] Scheduled notification generation
-   [ ] Role/office targeting
-   [ ] Tests

**Phase gate:** Scheduled processing reliably generates the correct
alert once per configured event/threshold.

------------------------------------------------------------------------

# Phase 12 --- Dashboard and Analytics

-   [ ] Total vehicle card
-   [ ] Serviceable count
-   [ ] In-use count
-   [ ] Under-maintenance count
-   [ ] Unserviceable count
-   [ ] Vehicle-by-office visualization
-   [ ] Upcoming renewal widget
-   [ ] Maintenance due widget
-   [ ] Recent activity
-   [ ] Fuel summary
-   [ ] Maintenance cost summary
-   [ ] Utilization summary
-   [ ] Dashboard filters if required
-   [ ] Cards link to filtered records
-   [ ] Office-scoped dashboard data
-   [ ] Performance optimization

**Phase gate:** Dashboard figures match source records and user
permissions.

------------------------------------------------------------------------

# Phase 13 --- Reports and Export

-   [ ] Vehicle Master List report
-   [ ] Vehicle History report
-   [ ] Assignment History report
-   [ ] Fuel Consumption report
-   [ ] Fuel PO report
-   [ ] Fuel Cost report
-   [ ] Maintenance History report
-   [ ] Maintenance Expense report
-   [ ] Trip History report
-   [ ] Vehicle Utilization report
-   [ ] LTO expiration report
-   [ ] GSIS/insurance expiration report
-   [ ] Driver assignment report
-   [ ] Driver license expiration report
-   [ ] Vehicle status report
-   [ ] Office Fleet Summary
-   [ ] Date-range filters
-   [ ] Office filters
-   [ ] Vehicle filters
-   [ ] Driver/status filters
-   [ ] Print view
-   [ ] PDF export
-   [ ] Excel/CSV export
-   [ ] Verify report totals

**Phase gate:** Client verifies that required official reports contain
correct records and totals.

------------------------------------------------------------------------

# Phase 14 --- Audit Trail

-   [x] Create audit service/middleware/signals strategy (`audit.services.log()` called explicitly from views)
-   [x] Vehicle creation/update/archive logs
-   [x] Assignment change logs
-   [x] Odometer correction logs (lowering odometer needs `fleet.correct_odometer`)
-   [ ] Fuel change logs
-   [ ] Maintenance change logs
-   [ ] Document change logs
-   [x] User/role change logs
-   [ ] Audit-log API
-   [ ] Audit-log UI
-   [ ] Admin-only/restricted permissions
-   [ ] Before/after values for critical changes
-   [x] Prevent modification/deletion by normal users (no write API; admin read-only)
-   [ ] Tests

**Phase gate:** Critical changes can be traced to user, timestamp,
entity, and before/after values.

------------------------------------------------------------------------

# Phase 15 --- Excel Data Migration

-   [ ] Make backup copy of source workbook
-   [ ] Create Excel-to-database field mapping
-   [ ] Normalize office names
-   [ ] Normalize vehicle names
-   [ ] Normalize driver/accountable-person names
-   [ ] Identify duplicate plate numbers
-   [ ] Identify malformed dates
-   [ ] Identify missing required fields
-   [ ] Build import command/script
-   [ ] Import vehicle master records
-   [ ] Import assignments
-   [ ] Import maintenance history
-   [ ] Import fuel history
-   [ ] Import Fuel PO log
-   [ ] Import trip/toll data where reliable
-   [ ] Import LTO/GSIS information
-   [ ] Produce import warnings
-   [ ] Produce import summary
-   [ ] Perform dry run on staging
-   [ ] Reconcile counts against Excel
-   [ ] Manually review flagged rows
-   [ ] Obtain client validation of migrated records

**Phase gate:** Staging migration reconciles with the source workbook
and no production data is silently overwritten.

------------------------------------------------------------------------

# Phase 16 --- Security Hardening

-   [ ] HTTPS configuration
-   [ ] Production CORS allowlist
-   [ ] CSRF configuration
-   [ ] Secure cookie/token configuration
-   [x] Password policy (min 10 chars, common/numeric/similarity checks, forced change for new accounts)
-   [ ] Rate-limit sensitive endpoints (partial: login 10/min)
-   [ ] File extension/MIME validation (partial: vehicle photos done; documents/attachments pending)
-   [ ] File size limits (partial: vehicle photos `VEHICLE_PHOTO_MAX_BYTES`)
-   [x] Safe upload paths/file names
-   [ ] Authorization review for every endpoint
-   [ ] Office-scoping penetration tests
-   [ ] Remove secrets from repository/history (verified clean at first push; re-check before production)
-   [ ] Production `DEBUG=False`
-   [ ] Secure headers
-   [ ] Logging does not expose credentials/tokens
-   [ ] Database least-privilege account
-   [ ] Backup encryption/access policy where applicable
-   [ ] Dependency vulnerability review

**Phase gate:** Security checklist and permission tests pass before
production deployment.

------------------------------------------------------------------------

# Phase 17 --- QA and User Acceptance Testing

## Functional QA

-   [ ] Test all CRUD workflows
-   [ ] Test filters/search/pagination
-   [ ] Test validation messages
-   [ ] Test uploads/downloads
-   [ ] Test notifications
-   [ ] Test reports
-   [ ] Test audit logs

## Role QA

-   [ ] System Administrator
-   [ ] Fleet Administrator
-   [ ] Field Office User
-   [ ] Viewer
-   [ ] Unauthorized user

## Technical QA

-   [ ] Backend automated tests
-   [ ] Frontend tests
-   [ ] API integration tests
-   [ ] Browser testing
-   [ ] Responsive testing
-   [ ] Performance testing
-   [ ] Backup/restore test
-   [ ] Error/recovery testing

## UAT

-   [ ] Prepare UAT scenarios
-   [ ] Import realistic staging data
-   [ ] Conduct client UAT
-   [ ] Record issues
-   [ ] Prioritize defects
-   [ ] Fix blocking/critical defects
-   [ ] Retest
-   [ ] Obtain UAT sign-off

------------------------------------------------------------------------

# Phase 18 --- Deployment

-   [ ] Provision production server/environment
-   [ ] Install/configure MySQL
-   [ ] Configure Django production environment
-   [ ] Configure React production build
-   [ ] Configure application server
-   [ ] Configure reverse proxy
-   [ ] Configure domain/DNS
-   [ ] Configure HTTPS
-   [ ] Configure persistent media storage
-   [ ] Configure scheduled jobs
-   [ ] Configure backups
-   [ ] Configure log rotation
-   [ ] Configure health monitoring
-   [ ] Create initial administrator
-   [ ] Run production migrations
-   [ ] Run approved data migration
-   [ ] Smoke-test production
-   [ ] Verify permissions
-   [ ] Verify reports
-   [ ] Verify file uploads
-   [ ] Verify backups

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
