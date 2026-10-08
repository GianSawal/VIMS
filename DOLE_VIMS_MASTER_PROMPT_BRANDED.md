# DOLE Vehicle Information Management System (VIMS)

## Master Development Prompt

### 1. Project Role and Objective

Act as a senior full-stack software architect and developer. Design and
implement a production-ready **DOLE Vehicle Information Management System (DOLE
VMS)** for the Department of Labor and Employment.

The application will replace and improve the current spreadsheet-based
vehicle record process. It must centralize vehicle master records,
assignments, drivers, trips, fuel, maintenance, documents, LTO/GSIS
renewals, RFID/toll records, reports, notifications, and audit trails.

Do **not** reproduce the Excel workbook as separate pages/tables per
vehicle. Use a normalized relational database where each vehicle has one
profile and related historical records.


## Mandatory Logo and UI Theme Requirement

**The VIMS logo is supplied in the project's `IMAGES` folder. Use that actual logo as the visual reference for the application.**

- Inspect the repository's `IMAGES` folder before designing the frontend. Identify the official VIMS logo file and use it; do not generate a replacement logo or substitute an unrelated icon.
- Derive the primary, secondary, and accent colors from the supplied logo. Create a consistent design-token palette (CSS variables or Tailwind theme tokens) and apply it across the entire React interface.
- Display the logo appropriately on the login page, sidebar/header, and other suitable branding locations. Preserve its aspect ratio and avoid distortion.
- Match navigation, buttons, active states, charts, badges, cards, and typography to the logo's visual identity while maintaining readable contrast and accessible focus states.
- Use a professional, modern government/enterprise aesthetic. Do not use arbitrary colors that clash with the logo.
- Support responsive desktop/mobile layouts and consistent light/dark behavior if dark mode is implemented.
- Reference the logo from the frontend's public assets or import it through the build system; avoid broken filesystem paths.
- If `IMAGES` contains multiple logo candidates, identify the likely primary logo and request confirmation before finalizing branding. If the folder/logo is missing, report that clearly instead of inventing logo colors.
- Document the selected logo filename and resulting color palette in the frontend README or design documentation.

**Acceptance criterion:** All primary pages visibly use the provided VIMS logo and a coherent, accessible UI theme derived from that logo.

### 2. Required Technology Stack

-   Frontend: **React.js**
-   Recommended frontend tooling: Vite, React Router, Axios, TanStack
    Query, React Hook Form, Zod, Tailwind CSS or a consistent component
    library, Lucide icons
-   Backend: **Django**
-   API: **Django REST Framework**
-   Database: **MySQL**
-   Authentication: Django/DRF authentication using secure HttpOnly
    cookie/session authentication or JWT with refresh-token strategy
-   File storage: configurable local storage during development;
    production-ready abstraction for document/image storage
-   Reporting: PDF/print-ready reports and Excel/CSV export where
    appropriate
-   Source control: Git + GitHub
-   API documentation: OpenAPI/Swagger
-   Environment configuration: `.env`; never commit secrets

### 3. Core Design Principles

1.  Vehicle-centric architecture: one vehicle profile contains its
    complete lifetime history.
2.  Normalize the database. Never create one table per vehicle.
3.  Use role-based access control and office-level data scoping.
4.  Keep a complete audit trail for important changes.
5.  Protect sensitive credentials and personally identifiable
    information.
6.  Use soft-delete/archive behavior for records that should remain
    historically traceable.
7.  Validate odometer, dates, monetary amounts, fuel quantities,
    document expirations, and assignment conflicts.
8.  Design for DOLE Regional Office and Field Office use.
9.  Responsive desktop-first interface with accessible forms and tables.
10. All calculations and business rules that affect official records
    must also be enforced by the backend, not only the frontend.

------------------------------------------------------------------------

## 4. User Roles and Permissions

### System Administrator

-   Full system access
-   Manage users, roles, offices, settings, reference data
-   Manage all vehicle records
-   View audit logs and all reports

### Fleet / Vehicle Administrator

-   Manage vehicles, assignments, drivers, trips, fuel, maintenance,
    documents and RFID records
-   Generate reports
-   Receive renewal/maintenance alerts
-   Cannot modify protected system configuration unless granted

### Field Office User

-   View and manage only vehicles/records assigned to their authorized
    office(s)
-   Add operational records such as fuel, trip and maintenance records
    as permitted
-   Cannot access other offices unless explicitly authorized

### Management / Viewer

-   Read-only dashboard, vehicle records and reports
-   No create/update/delete privileges

Implement permissions in the Django API. Hiding buttons in React is not
sufficient security.

------------------------------------------------------------------------

# 5. Functional Modules

## 5.1 Authentication and Account Management

Implement: - Login/logout - Secure password handling - Password
change/reset flow - User activation/deactivation - Role assignment -
Office assignment - Last-login information - Optional forced password
change for newly created accounts - Session/token expiration handling -
Unauthorized/forbidden pages

## 5.2 Dashboard

Create an operational dashboard showing: - Total vehicles - Serviceable
vehicles - In-use vehicles - Under-maintenance vehicles - Unserviceable
vehicles - Vehicles by office - Upcoming LTO renewals - Upcoming
GSIS/insurance expirations - Maintenance due/overdue - Driver license
expirations - Recent activity - Fuel consumption summary - Maintenance
expenditure summary - Vehicle utilization summary

Dashboard cards/charts must link to filtered detail views.

## 5.3 Vehicle Master Records

Vehicle fields should support: - Internal ID - Plate number - Property
number - Make - Model - Variant - Year model - Vehicle type/category -
Color - Engine number - Chassis number - Fuel type - Acquisition date -
Acquisition cost - Current odometer - Assigned office - Current
accountable person - Current driver - Vehicle image - Status - Remarks -
Archived flag

Recommended statuses: - Serviceable - In Use - Under Maintenance - For
Repair - Unserviceable - Disposed - Archived

Plate number, engine number, chassis number and property number should
support uniqueness rules as appropriate.

### Vehicle Profile

Each vehicle profile must contain: - Overview - Assignment history -
Trip history - Fuel history - Maintenance history - Documents/renewals -
RFID/toll information - Attachments - Activity/audit history where
permitted


### Vehicle Profile Photo Upload and Management

The Vehicle Profile must include an **actual vehicle photograph**, uploaded and managed by authorized administrators. This is a core feature, separate from any optional 3D viewer.

**Required behavior:**
- System Administrators and Fleet Administrators with explicit permission can upload, replace, and remove vehicle photos.
- Display the primary vehicle photo prominently on the Vehicle Profile overview and as a thumbnail on the Vehicle Master List.
- Support JPEG, PNG, and WebP images; validate file type and configurable file size limits on the Django backend.
- Provide image preview before saving, clear upload progress and success/error feedback.
- Use a generic vehicle placeholder when no photo exists.
- Store uploaded files in configured media/object storage; store the file path/reference and metadata in MySQL, not raw image binary.
- Assign each uploaded photo to its vehicle using a relational reference. Allow one primary photo, with optional additional gallery photos as a later enhancement.
- Restrict photo modification APIs by role and office permissions; other authorized users may view photos.
- Use safe generated filenames and prevent path traversal; serve images using appropriate access rules.
- Record photo upload, replacement, and removal in the audit trail.
- On replacement, update the profile immediately and safely clean up obsolete files according to retention policy.
- Support responsive display, proper aspect ratio, and an accessible image description.
- Include photo upload in API tests, frontend tests, and user acceptance testing.

**Suggested API:** `POST /api/vehicles/{id}/photo/`, `DELETE /api/vehicles/{id}/photo/`; include a `photo_url` in the vehicle detail response. The precise endpoints may be adapted to the project API conventions.

**Suggested UI:** Vehicle Profile → Overview → prominent photo panel with **Upload Photo / Change Photo / Remove Photo** actions visible only to authorized administrators.

## 5.4 Office Management

Maintain offices as reference records rather than hard-coded strings.

Fields: - Office code - Office name - Office type - Parent office, if
needed - Active/inactive status

Support Regional Office and Field Office deployment.

## 5.5 Driver Management

Maintain reusable driver profiles: - Employee/personnel reference or
employee number - Full name - Office - Contact information if required -
License number - License type/restriction - License issue date - License
expiration date - Status - Attachments - Current vehicle assignment

Provide driver-license expiration alerts.

## 5.6 Vehicle Assignment

Do not overwrite assignment history.

Store: - Vehicle - Assigned office - Accountable person - Driver -
Assignment start date - Assignment end date - Assignment status -
Remarks - Created/approved by where applicable

Only one current primary assignment should exist for a vehicle unless
the business rule explicitly permits otherwise.

## 5.7 Trip Management

Trip records should support: - Trip ticket/reference number - Vehicle -
Driver - Date/time out - Date/time returned - Passenger/requesting
office - Origin - Destination/place visited - Purpose - Starting
odometer - Ending odometer - Calculated distance - Remarks - Status -
Attachments

Validation: - Ending odometer cannot be below starting odometer. - New
odometer entries cannot contradict the vehicle's accepted odometer
history without authorized correction. - A vehicle under
maintenance/unserviceable should not normally be dispatched.

## 5.8 Toll / RFID Transactions

Support Easytrip/RFID or similar accounts: - Provider -
Account/reference number - Vehicle - Status - Optional protected
credential reference - Balance where manually recorded/integrated -
Remarks

Transactions: - Date/time - Trip - Vehicle - Description/toll plaza -
Credit - Debit - Running/calculated balance where appropriate -
Reference number

Do not store third-party plaintext passwords by default. If the
organization explicitly requires credentials, encrypt them at rest,
restrict access, mask them in UI, log access where feasible, and never
return them in list APIs.

## 5.9 Fuel Management

Fuel record: - Date - Vehicle - Driver - Purchase Order number -
Supplier/fuel station - Fuel type - Quantity in liters - Unit price -
Total amount - Odometer - Receipt/reference - Attachment - Remarks

Calculated analytics: - Distance since previous valid fueling -
Estimated km/L - Fuel consumption by vehicle - Fuel consumption by
office - Fuel cost by vehicle/office/period - Unusual consumption
indicators

Do not calculate misleading km/L when the available records do not
represent comparable/full-tank measurements. Clearly label estimates.

## 5.10 Fuel Purchase Order Log

Provide a dedicated view/report for: - Date - PO number - Vehicle - Fuel
liters - Odometer - Driver - Supplier - Amount - Supporting document

Fuel PO records should reuse the same underlying fuel data where
possible rather than duplicate records.

## 5.11 Maintenance Management

Maintenance record: - Vehicle - Date - Odometer - PR/reference number -
Maintenance type/category - Description - Supplier/service provider -
Labor cost - Parts cost - Total cost - Start/completion date - Status -
Next service date - Next service odometer - Attachments - Remarks

Categories should include: - Preventive Maintenance - Engine - Tires -
Brakes - Air Conditioning - Battery - Body - Electrical - Other

Support multiple categories per maintenance event if needed.

Statuses: - Scheduled - For Inspection - In Progress - Completed -
Cancelled

### Preventive Maintenance

Generate due/overdue indicators based on: - Date interval - Odometer
threshold - Whichever rule is configured for that maintenance schedule

Show remaining kilometers/days where possible.

## 5.12 Documents and Renewals

Vehicle documents may include: - LTO registration - Official Receipt -
Certificate of Registration - GSIS/insurance - Insurance policy -
Deed/property records - Inspection records - Other attachments

Store: - Document type - Vehicle - Reference number - Issue date -
Expiration date - File - Status - Remarks

Generate alerts at configurable thresholds such as: - 60 days - 30
days - 15 days - 7 days - Expired

Avoid duplicate notifications for the same threshold/event.

## 5.13 Notifications

In-app notification center: - Document expiration - LTO renewal -
GSIS/insurance expiration - Driver license expiration - Maintenance
due - Maintenance overdue - Assignment-related events if required

Fields: - Recipient - Type - Title - Message - Related object - Created
date - Read/unread - Resolved/dismissed where appropriate

## 5.14 Reports

Implement filterable reports: - Vehicle Master List - Vehicle
Profile/History - Vehicle Assignment History - Fuel Consumption - Fuel
Purchase Order - Fuel Cost - Maintenance History - Maintenance Expense -
Trip History - Vehicle Utilization - LTO Renewal/Expiration -
GSIS/Insurance Expiration - Driver Assignment - Driver License
Expiration - Serviceable/Unserviceable Vehicle - Office Fleet Summary

Filters should include relevant combinations of: - Date range - Office -
Vehicle - Driver - Status - Document type - Maintenance category

Support: - On-screen preview - Print-friendly view - PDF export -
Excel/CSV export where appropriate

## 5.15 Audit Trail

Record important events such as: - Login/security events where
appropriate - Vehicle creation/update/archive - Assignment changes -
Odometer corrections - Fuel changes - Maintenance changes - Document
changes - User/role changes - Sensitive record access where required

Audit entries should include: - User - Timestamp - Action - Entity
type - Entity ID - Human-readable description - Previous values for
important fields - New values - IP/user agent if policy permits

Ordinary users must not be able to edit audit records.

------------------------------------------------------------------------

# 6. Suggested Data Model

Create normalized Django models such as:

-   User
-   Role/Group (prefer Django permissions/groups where suitable)
-   Office
-   Vehicle
-   VehicleAssignment
-   Driver
-   DriverLicense / driver license fields
-   Trip
-   TollTransaction
-   RFIDAccount
-   FuelRecord
-   MaintenanceRecord
-   MaintenanceCategory
-   MaintenanceSchedule
-   VehicleDocument
-   VehicleAttachment
-   Notification
-   AuditLog
-   Reference/lookup models as necessary

Use foreign keys rather than duplicating names.

Important historical records should use snapshots where necessary so
reports remain accurate even if a person's display name or office
metadata later changes.

------------------------------------------------------------------------

# 7. API Requirements

Use RESTful endpoints with Django REST Framework.

Example endpoint groups: - `/api/auth/` - `/api/users/` -
`/api/offices/` - `/api/vehicles/` - `/api/vehicles/{id}/assignments/` -
`/api/drivers/` - `/api/trips/` - `/api/fuel-records/` -
`/api/maintenance/` - `/api/documents/` - `/api/rfid-accounts/` -
`/api/toll-transactions/` - `/api/notifications/` - `/api/reports/` -
`/api/audit-logs/`

Requirements: - Pagination - Search - Filtering - Ordering - Serializer
validation - Object-level permission checks where needed - Consistent
error format - Appropriate HTTP status codes - Transaction handling for
multi-record operations - OpenAPI documentation

Avoid N+1 queries using `select_related`/`prefetch_related`.

------------------------------------------------------------------------

# 8. React Frontend Requirements

Recommended route structure:

-   `/login`
-   `/dashboard`
-   `/vehicles`
-   `/vehicles/new`
-   `/vehicles/:id`
-   `/vehicles/:id/edit`
-   `/trips`
-   `/fuel`
-   `/maintenance`
-   `/drivers`
-   `/documents`
-   `/reports`
-   `/notifications`
-   `/admin/users`
-   `/admin/offices`
-   `/audit-logs`

### UI Standards

-   Professional government/enterprise visual design
-   DOLE branding can be applied without sacrificing readability
-   Responsive sidebar/navigation
-   Breadcrumbs
-   Reusable data table
-   Search/filter/sort/pagination
-   Loading skeletons
-   Empty states
-   Confirmation dialogs for destructive actions
-   Toasts for operation results
-   Accessible labels and keyboard navigation
-   Clear status badges
-   Avoid excessive animations
-   Use consistent date, currency and number formatting
-   Philippine Peso formatting for costs
-   Mobile-friendly critical views, while optimizing data-heavy
    administration for desktop

------------------------------------------------------------------------

# 9. Security Requirements

Implement: - HTTPS in production - Secure authentication/token/session
strategy - CSRF protection when applicable - CORS allowlist - Django
password hashing - Backend RBAC - Office-level authorization - File
type/size validation - Safe randomized file names/storage paths - SQL
injection protection through ORM - XSS-safe rendering - Rate limiting
for sensitive endpoints where appropriate - No secrets in source
control - Environment variables for database and secret keys -
Restricted audit-log access - No plaintext third-party passwords -
Database backups and restore procedure - Production logging without
leaking secrets

Follow the principle of least privilege.

------------------------------------------------------------------------

# 10. Business Rules and Validation

At minimum: 1. Plate numbers must not be duplicated for active vehicles.
2. Odometer values must be non-negative and chronological unless an
authorized correction is recorded. 3. Trip ending odometer \>= starting
odometer. 4. Fuel quantity and costs cannot be negative. 5. Maintenance
costs cannot be negative. 6. Expiration date should not precede issue
date. 7. Completed maintenance should update relevant maintenance
schedule information. 8. Current vehicle assignment should be
historically traceable. 9. Archived/disposed vehicles remain available
in historical reports. 10. Field-office users can access only permitted
office data. 11. File uploads must be validated. 12. Critical deletions
should generally be archival/soft deletion or protected deletion. 13.
Changes to important financial/odometer fields should be audited. 14.
Status transitions should be validated where needed.

------------------------------------------------------------------------

# 11. Excel Migration

The current spreadsheet is a migration source.

Create an import process that: 1. Imports the master vehicle list. 2.
Maps office names to Office records. 3. Creates vehicle records using
plate numbers as migration identifiers. 4. Imports vehicle-specific
maintenance histories. 5. Imports fuel histories and Fuel PO logs. 6.
Imports trip/toll histories where the source data is reliable. 7.
Imports driver/accountable-person names without blindly creating
duplicates. 8. Flags incomplete, malformed, conflicting, or duplicate
rows for manual review. 9. Produces an import summary: created, updated,
skipped, warning, failed. 10. Never overwrite existing production
records silently.

Before migration, create a field-mapping document from Excel columns to
database fields.

------------------------------------------------------------------------

# 12. Testing Requirements

### Backend

Use Django/pytest tests for: - Authentication - Permissions - Office
scoping - Vehicle CRUD - Assignment history - Odometer validation - Fuel
calculations - Maintenance scheduling - Document expiration logic -
Notifications - Reports - Import logic - Audit logs

### Frontend

Test: - Authentication flow - Protected routes - Forms and validation -
Filters/search - Vehicle profile - Error states - Role-based controls -
Key operational workflows

### System Testing

Perform: - Unit testing - Integration testing - API testing - Security
testing - Responsive/browser testing - User acceptance testing -
Backup/restore testing - Excel migration dry run

------------------------------------------------------------------------

# 13. Deployment Architecture

Maintain separate: - Development - Staging/UAT - Production

Production components should include: - React production build - Django
application server - MySQL - Reverse proxy (e.g. Nginx) - HTTPS
certificate - Persistent media/document storage - Scheduled backups -
Application/error logging - Monitoring/health checks

Never run Django's development server as the production server.

------------------------------------------------------------------------

# 14. Development Method

Build incrementally. Do not attempt all modules in one giant generation.

For each feature: 1. Confirm data model/business rule. 2. Create/update
Django model and migration. 3. Create serializer/service/business logic.
4. Create API endpoint and permissions. 5. Write backend tests. 6. Build
React API layer/hooks. 7. Build UI. 8. Add loading/error/empty states.
9. Test permissions. 10. Update documentation.

Do not use placeholder/mock data once the corresponding API exists.

------------------------------------------------------------------------

# 15. Definition of Done

A feature is complete only when: - Database migration exists - Backend
validation exists - Permissions are enforced server-side - API is
implemented - React UI is connected to real API - Loading/error/empty
states exist - Validation messages are understandable - Tests pass -
Audit logging is implemented where required - Documentation is updated -
Feature has been manually tested using at least the Admin and
restricted-role scenarios

------------------------------------------------------------------------

# 16. Expected Final Product

The finished VIMS must allow an authorized user to open a vehicle
such as a Toyota Innova and immediately understand: - What the vehicle
is - Its current status and odometer - Where it is assigned - Who is
accountable for it - Who drives it - Its complete assignment history -
Its trips and utilization - Its fuel usage and costs - Its maintenance
history and upcoming maintenance - Its LTO/GSIS/document status - Its
RFID/toll records - Its attachments - Its historical activity

The system must provide more operational value than the original
spreadsheet through centralized data, automated alerts, historical
traceability, analytics, permissions, reporting, and auditability.
