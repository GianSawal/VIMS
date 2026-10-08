# DOLE Vehicle Information Management System (VIMS)

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

-   [x] Create Git repository
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

-   [ ] Vehicle CRUD API
-   [ ] Vehicle search
-   [ ] Vehicle filtering
-   [ ] Vehicle sorting
-   [ ] Pagination
-   [ ] Vehicle status validation
-   [ ] Vehicle image upload
-   [ ] Archive/reactivate vehicle
-   [ ] Plate/property/engine/chassis uniqueness rules
-   [ ] Vehicle permissions
-   [ ] Vehicle tests

## Frontend

-   [ ] Vehicle master list
-   [ ] Search bar
-   [ ] Office filter
-   [ ] Status filter
-   [ ] Vehicle type filter
-   [ ] Add Vehicle form
-   [ ] Edit Vehicle form
-   [ ] Vehicle status badges
-   [ ] Vehicle profile layout
-   [ ] Overview tab
-   [ ] Empty/loading/error states
-   [ ] Confirmation dialogs

**Phase gate:** Users can securely create, locate, view, update and
archive vehicles according to role/office permissions.

------------------------------------------------------------------------

### Vehicle Profile Photo Upload (Admin)
- [x] Add vehicle photo field/storage model and migration (`Vehicle.photo`, random file names)
- [ ] Configure Django media storage for vehicle photos
- [ ] Create authenticated photo upload endpoint
- [ ] Create photo replacement and removal endpoints
- [ ] Restrict photo changes to authorized administrators
- [ ] Enforce office-level access restrictions
- [ ] Validate JPEG/PNG/WebP and file size on backend
- [ ] Generate safe file names and prevent unsafe uploads
- [ ] Add upload control to Vehicle Profile Overview
- [ ] Add preview before upload and progress/error states
- [ ] Display primary photo on Vehicle Profile
- [ ] Display photo thumbnails on Vehicle Master List
- [ ] Display placeholder when photo is missing
- [ ] Make photo display responsive with correct aspect ratio
- [ ] Audit photo uploads, replacements and removals
- [ ] Test upload, replacement, deletion and unauthorized access
- [ ] Include photo management in client UAT

# Phase 5 --- Driver and Assignment Module

-   [ ] Driver CRUD API
-   [ ] Driver list/profile UI
-   [ ] Driver license fields
-   [ ] Driver license attachments
-   [ ] Driver license expiration logic
-   [ ] Vehicle assignment API
-   [ ] Assign vehicle to office
-   [ ] Assign accountable person
-   [ ] Assign driver
-   [ ] Assignment start/end dates
-   [ ] Prevent conflicting current assignments
-   [ ] Assignment history
-   [ ] Reassignment workflow
-   [ ] Display current assignment on vehicle profile
-   [ ] Driver/assignment permissions
-   [ ] Tests

**Phase gate:** Reassignment preserves previous assignment history
instead of overwriting it.

------------------------------------------------------------------------

# Phase 6 --- Trip Management

-   [ ] Trip CRUD API
-   [ ] Trip-ticket/reference number
-   [ ] Vehicle selection
-   [ ] Driver selection
-   [ ] Passenger/requesting office
-   [ ] Origin/destination
-   [ ] Purpose
-   [ ] Date/time out
-   [ ] Date/time returned
-   [ ] Starting odometer
-   [ ] Ending odometer
-   [ ] Calculate distance
-   [ ] Odometer validation
-   [ ] Vehicle-status dispatch validation
-   [ ] Trip attachment
-   [ ] Trip list
-   [ ] Trip detail
-   [ ] Vehicle trip-history tab
-   [ ] Trip filters
-   [ ] Tests

**Phase gate:** Trip completion updates/validates vehicle odometer
correctly and preserves history.

------------------------------------------------------------------------

# Phase 7 --- Fuel Management

-   [ ] Fuel CRUD API
-   [ ] Fuel Purchase Order number
-   [ ] Vehicle
-   [ ] Driver
-   [ ] Supplier
-   [ ] Fuel type
-   [ ] Fuel quantity
-   [ ] Unit price
-   [ ] Total cost
-   [ ] Odometer
-   [ ] Receipt/reference
-   [ ] Attachment
-   [ ] Fuel list
-   [ ] Vehicle fuel-history tab
-   [ ] Fuel PO log view
-   [ ] Date/office/vehicle filters
-   [ ] Fuel cost calculation
-   [ ] Distance-between-fueling calculation
-   [ ] Estimated km/L calculation
-   [ ] Clearly label estimated fuel efficiency
-   [ ] Detect invalid odometer sequence
-   [ ] Tests

**Phase gate:** Fuel history and PO report can reproduce required
existing spreadsheet information without duplicate data entry.

------------------------------------------------------------------------

# Phase 8 --- Maintenance Management

-   [ ] Maintenance CRUD API
-   [ ] Maintenance categories
-   [ ] Multiple categories per event if required
-   [ ] PR/reference number
-   [ ] Supplier/service provider
-   [ ] Description
-   [ ] Odometer
-   [ ] Labor cost
-   [ ] Parts cost
-   [ ] Total cost
-   [ ] Maintenance status
-   [ ] Start/completion date
-   [ ] Attachments
-   [ ] Vehicle maintenance-history tab
-   [ ] Maintenance schedule model
-   [ ] Next service date
-   [ ] Next service odometer
-   [ ] Due-soon calculation
-   [ ] Overdue calculation
-   [ ] Maintenance filters
-   [ ] Tests

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
-   [ ] Vehicle creation/update/archive logs
-   [ ] Assignment change logs
-   [ ] Odometer correction logs
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
-   [ ] File extension/MIME validation
-   [ ] File size limits
-   [ ] Safe upload paths/file names
-   [ ] Authorization review for every endpoint
-   [ ] Office-scoping penetration tests
-   [ ] Remove secrets from repository/history
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
