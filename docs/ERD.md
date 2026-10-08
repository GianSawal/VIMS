# VIMS ERD

Generated from the Django models (Phase 2). `Tracked` models also carry `created_at`, `updated_at`, `created_by → User`.

```mermaid
erDiagram
    Office ||--o{ Office : parent
    Office }o--o{ User : "offices (access scope)"
    Group }o--o{ User : "role"
    Office ||--o{ Vehicle : owns
    Office ||--o{ Driver : employs
    Vehicle ||--o{ VehicleAssignment : history
    Office ||--o{ VehicleAssignment : "assigned to"
    Driver |o--o{ VehicleAssignment : drives
    Vehicle ||--o{ VehicleDocument : "LTO / OR / CR / GSIS"
    Vehicle ||--o{ Trip : ""
    Driver ||--o{ Trip : ""
    Vehicle ||--o{ FuelRecord : "also Fuel PO log"
    Driver |o--o{ FuelRecord : ""
    Vehicle |o--o{ RFIDAccount : ""
    RFIDAccount ||--o{ TollTransaction : ""
    Trip |o--o{ TollTransaction : ""
    Vehicle ||--o{ MaintenanceRecord : ""
    MaintenanceRecord }o--o{ MaintenanceCategory : categories
    Vehicle ||--o{ MaintenanceSchedule : "PM rules"
    MaintenanceCategory ||--o{ MaintenanceSchedule : ""
    User ||--o{ Notification : recipient
    User |o--o{ AuditLog : actor

    Vehicle {
        string plate_number "unique among non-archived"
        string property_number UK "nullable"
        string engine_number UK "nullable"
        string chassis_number UK "nullable"
        int current_odometer ">= 0"
        enum status
        image photo
        bool is_archived
    }
    VehicleAssignment {
        date start_date
        date end_date "NULL = current; one open per vehicle"
        string accountable_person "name snapshot"
    }
    Trip {
        string ticket_number UK
        int odometer_start
        int odometer_end ">= start"
        int distance_km "generated"
    }
    FuelRecord {
        string po_number
        decimal liters ">= 0"
        decimal total_amount ">= 0"
        bool is_full_tank "km/L only between full tanks"
    }
    MaintenanceRecord {
        decimal labor_cost
        decimal parts_cost
        decimal total_cost "generated"
        date next_service_date
        int next_service_odometer
    }
    MaintenanceSchedule {
        int interval_days "at least one interval"
        int interval_km
    }
    VehicleDocument {
        enum document_type
        date expiry_date ">= issue_date"
        enum status "ACTIVE / SUPERSEDED"
    }
    Notification {
        string dedupe_key "unique per recipient"
    }
    AuditLog {
        string username "snapshot"
        json changes "field: [old, new]"
    }
```

`Attachment` (not drawn) links a file to any record via a generic foreign key (`content_type`, `object_id`).

## Rules and where they're enforced

| Rule | Where |
|---|---|
| Plate unique among active vehicles | `Vehicle.clean()` (MySQL has no partial unique index) |
| One current assignment per vehicle | `VehicleAssignment.clean()`; Phase 5 service adds row locking |
| Non-negative odometer, liters, costs | DB CHECK |
| End date/odometer not before start | DB CHECK |
| Trip distance and maintenance total | DB generated columns |
| No duplicate threshold alerts | DB UNIQUE (`recipient`, `dedupe_key`) |
| Audit log append-only | Admin read-only; no write API |

## Roles (`python manage.py seed_reference`)

| Group | Model permissions |
|---|---|
| System Administrator | all, every VIMS app |
| Fleet Administrator | add/change/view on fleet, operations, maintenance; view offices |
| Field Office User | view fleet; add/change trips, fuel, tolls, maintenance records |
| Viewer | view only (no audit, no users) |

No role gets `delete` except System Administrator; records are archived instead. Office scoping (`User.offices`) is applied in Phase 3.
