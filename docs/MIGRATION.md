# Excel data migration

How DOLE's old vehicle spreadsheet gets into the system. The old workbook is laid out one sheet per vehicle,
which the system deliberately does not copy. Instead, the data is copied into one **standard import workbook**
(one sheet per kind of record), checked by a dry run, and then imported.

## Procedure

1. **Back up the old workbook** and work on a copy. The importer also copies every file it reads into
   `backend/import_runs/` (git-ignored) before touching anything.
2. **Get the blank template:** in the app, Administration → **Data Import** → *Download template* (System
   Administrator role, permission `accounts.import_data`), or on the server
   `python manage.py import_workbook --template vrs-import-template.xlsx`
   The *Instructions* sheet lists every column, whether it is required, and the allowed values. Header
   cells carry the same notes as comments.
3. **Set up offices first** in the app (Administration → Offices). Offices are not imported. If the old sheets
   spell an office differently ("Tarlac FO"), add a row to the *Offices* sheet mapping that spelling to the
   office code.
4. **Copy the old data into the template.** One row per vehicle, driver, assignment, document, maintenance job,
   fill-up, trip and toll transaction. Leave a sheet empty to skip it. For RO3's workbook
   (`DATA/VEHICLE RECORD.xlsx`, git-ignored) this is automatic, in three steps:
   1. `python manage.py import_workbook --prepare "../DATA/VEHICLE RECORD.xlsx" "../DATA/VEHICLE RECORD (to fill).xlsx"`
      writes a copy with the columns the old sheets lack (see "Added columns" below), highlighted in yellow.
      The EasyTrip USERNAME / PW cells are blanked in the copy. The original is not changed.
   2. Staff fill the highlighted cells in that copy, in the sheets they already know.
   3. `python manage.py import_workbook --convert "../DATA/VEHICLE RECORD (to fill).xlsx" import_runs/converted.xlsx`
      The *Conversion notes* sheet lists what was inferred or left out, and how many highlighted cells are
      still blank. Fill those and convert again before the dry run.
5. **Dry run on staging** (a copy of the database, never production first):
   `python manage.py import_workbook filled.xlsx --user <your username>`
   Nothing is saved. The command prints a summary and writes
   `import_runs/<time>-<name>-dryrun-report.xlsx`:
   - *Summary* gives created / updated / skipped / failed / warnings per sheet;
   - *Issues* lists every flagged row with sheet, Excel row number, field, message and value, plus an empty
     "Reviewed by / action" column for the person checking it.
6. **Fix and repeat.** Correct the workbook, not the report, until there are no errors. Check that each
   remaining warning is acceptable.
7. **Reconcile.** Compare the *Summary* counts with the old workbook: the number of vehicles, fill-ups per
   vehicle, and total fuel and maintenance amounts. The Reports module (Vehicle Master List, Fuel Cost, Maintenance
   Expense) gives the totals after a staging import.
8. **Import for real:** add `--commit`. One audit entry ("import") records who ran it and the summary.
9. **Client validation:** the client reviews the migrated records on staging before the production import.

Running the same workbook again is safe. Rows that are already in the system are skipped, so a second run
creates nothing. Only missing blanks get filled, as described in the rules below.

## Rules the importer applies

| Situation | What happens |
|---|---|
| Vehicle plate already in the system | Not re-created. Only fields that are **blank** in the system are filled ("updated"). Fields that differ are kept and reported as a warning, so values are never silently overwritten. Status is never taken from the sheet for an existing vehicle. |
| Driver license number already in the system | Same as vehicles: blanks filled, differences reported. |
| Driver name matches another driver with a different license | Created as a separate driver with a warning to check it isn't the same person. |
| Same plate twice on the Vehicles sheet | Spellings like `SAB 1234`, `SAB-1234` and `sab1234` count as the same plate. The second row fails. |
| Same license number twice on the Drivers sheet | The second row fails. |
| Office name | Matched by code, by name (ignoring case, punctuation and the word "DOLE"), or by the Offices sheet. If none matches, the row fails. |
| Person names (driver on assignments, fuel, trips) | Matched ignoring case, extra spaces and punctuation, but the middle initial must agree. If exactly one driver matches, the record is linked; otherwise the name is kept as text with a warning. Trips need a driver, so an unmatched trip fails. |
| Dates | Excel date cells, `YYYY-MM-DD`, `MM/DD/YYYY`, `15-Mar-2025`, `Mar 15, 2025`. Anything else fails the row (e.g. `31/31/2020`). |
| Amounts | `1,500.00`, `₱1,500` and `PHP 1500` are accepted. Negative amounts fail. |
| Choice columns (type, fuel, status…) | The value or its label, in any case or punctuation: `Pick-up` = Pickup, `gsis insurance` = GSIS Insurance. |
| Missing required column | The whole sheet is skipped with an error. |
| Missing required cell | The row fails. |
| Several LTO / OR / CR / insurance rows for one vehicle | Treated as history: the latest expiry becomes Active and older ones Superseded. If the system already has an active one, all imported rows become history. |
| Maintenance status | Only completed or cancelled jobs are imported (enter open jobs in the app). Completed date defaults to the job date. Unknown categories are filed under Other with a warning. |
| Fuel total differs from liters × price by more than ₱1 | Imported with the amount given, with a warning. |
| Fuel type differs from the vehicle's | Imported, with a warning. |
| Fuel PO log | The PO number column of the Fuel sheet, so the same fill-up is never entered twice. |
| Trips | Completed (needs return time and both odometer readings) or cancelled only. An existing ticket number is skipped. |
| Toll rows | Exactly one of credit (load) or debit (toll). Unknown RFID accounts are created for the row's vehicle with a warning. Account numbers are masked in the report. |
| Odometer | After the import, a vehicle's odometer is raised to the highest reading in its imported fuel, maintenance and trip rows, with a warning. It is never lowered. |
| A row already imported | Skipped. The match is plate + date + description (maintenance), plate + date + odometer + liters (fuel), ticket (trips), plate + type + expiry + reference (documents), plate + start date (assignments), or account + time + amount + description (toll). |

Historical rows are written straight to the database models with full model validation. They do not go through
the live-entry services, whose "today" rules (odometer only goes up, an open job puts the vehicle under maintenance)
can't apply to old records.

## Field mapping

Template column → database field. `*` = required. The old spreadsheet's columns are mapped onto these when the
data is copied into the template (step 4). Record that mapping in the table at the end once the source workbook
is available.

| Sheet | Column | Database field |
|---|---|---|
| Vehicles | Plate number * | `Vehicle.plate_number` (migration identifier, uppercased) |
| | Property / Engine / Chassis number | `property_number`, `engine_number`, `chassis_number` (uppercased; blank → NULL) |
| | Make *, Model *, Variant, Year model, Color | same names |
| | Vehicle type *, Fuel type * | `vehicle_type`, `fuel_type` (choices) |
| | Acquisition date, Acquisition cost | same names |
| | Current odometer | `current_odometer` (default 0; raised by later sheets) |
| | Office * | `office` (code, name or Offices-sheet alias) |
| | Status | `status` (default Serviceable; new vehicles only) |
| | Remarks | `remarks` |
| Drivers | Full name *, Employee number, Office *, Contact number | `Driver.full_name`, `employee_number`, `office`, `contact_number` |
| | License number *, License type *, License restrictions, License issue date, License expiry date * | same names |
| Assignments | Plate number *, Office *, Accountable person *, Start date *, End date, Remarks | `VehicleAssignment.vehicle`, `office`, `accountable_person`, `start_date`, `end_date` (blank = current), `remarks` |
| | Driver name | `driver` (when matched) and `driver_name` (snapshot) |
| Documents | Plate number *, Document type *, Reference number, Issue date, Expiry date, Remarks | `VehicleDocument.vehicle`, `document_type`, `reference_number`, `issue_date`, `expiry_date`, `remarks`; `status` set as above |
| Maintenance | Plate number *, Date *, Odometer, Reference number, Description *, Service provider, Labor cost, Parts cost, Status, Completed on, Remarks | `MaintenanceRecord.*` (same names; `total_cost` is computed) |
| | Categories | `categories` (comma-separated names) |
| Fuel | Plate number *, Date *, PO number, Supplier, Fuel type, Liters *, Unit price *, Total amount, Odometer *, Is full tank, Receipt number, Remarks | `FuelRecord.*` (same names) |
| | Driver name | `driver` (when matched) |
| Trips | Ticket number *, Plate number *, Driver name *, Requesting office, Origin *, Destination *, Purpose *, Departed at *, Returned at, Odometer start, Odometer end, Status, Remarks | `Trip.*` (same names; `distance_km` is computed) |
| Toll | Provider *, Account number *, Plate number * | `RFIDAccount` (found or created by provider + number) and `TollTransaction.vehicle` |
| | Transacted at *, Description *, Credit, Debit, Reference number, Ticket number | `TollTransaction.*` (`trip` linked by ticket) |

### Old spreadsheet → template (`dataimport/legacy.py`)

RO3's workbook has a master sheet `RO3` and one sheet per vehicle. Each vehicle sheet has three blocks side by
side: maintenance (A–E), fuel and odometer readings (G–I), and the RFID / trip log (from column K; its columns are
found by header name because the order differs between sheets).

| Old sheet / column | Template sheet / column | Notes |
|---|---|---|
| RO3 PN | Vehicles: Plate number | Vehicle sheets are matched by their PLATE NO. cell, else by sheet name. |
| RO3 VEHICLE | Make, Model, Variant | First word, second word, the rest (`TOYOTA` / `HIACE` / `COMMUTER 3.0 M/T`). |
| RO3 VEHICLE | Vehicle type, Fuel type | Inferred: HiAce/L300/Travis = Van, Innova/Crosswind/Adventure/Revo/Sportivo = SUV; Diesel when the text says so or the model is sold only as diesel. Otherwise blank. |
| RO3 COLOR, OFFICE, REMARKS | Color, Office, Status | Office spellings are mapped on the Offices sheet (`REGIONAL OFFICE` → R03, `TARLAC` → TAR, …). |
| Vehicle sheet title | Vehicles: Remarks | Another plate number in the title (e.g. `SCD 2797`) is kept as "Other plate in the old sheet". |
| Vehicle sheet ODO, "PMS (km)" | Current odometer | Highest reading on the sheet. |
| RO3 PAR, DRIVER | Assignments: Accountable person, Driver name | The DRIVER column (`SURNAME, FIRST MIDDLE`) is matched to the driver list by surname + first name. |
| RO3 GSIS | Documents: GSIS Insurance, Expiry date | |
| RO3 LTO, Renew Date | Documents: LTO Registration, Issue date; Remarks "Renewal month" | |
| RO3 EASYTRIP | Toll: Account number (provider Easytrip) | |
| RO3 USERNAME, PW | — | **Never read.** The system stores no third-party credentials. |
| RO3 driver list: DRIVER, LICENSE NUMBER, EXP.DATE, PLACE, MOBILE No. | Drivers: Full name, License number, License expiry date, Office, Contact number | |
| Maintenance DATE, PR No., DESCRIPTION, SUPPLIER, COST | Maintenance: Date, Reference number, Description, Service provider, Parts cost | One COST column, so it all goes to parts cost. `Free` = 0 with a remark. Odometer from `PMS (1622)` / `PMS 1,287 KM`. Categories from words in the description. |
| Fuel DATE, ODO, FUEL LITERS | Fuel: Date, Odometer, Liters | Only rows with liters. Rows with just an odometer are daily readings, used for the current odometer. |
| Log DATE, TRIP TICKET No., DESCRIPTION, CREDIT, DEBIT | Toll: Transacted at, Reference number, Description, Credit, Debit | Date at 08:00, one minute apart per row, to keep the sheet order. Negative charges are made positive. "Toll" in CREDIT = a charge; "RELOAD" = a load (its amount sits in DEBIT); "Toll/Reload" = both, the load taken from the label or worked out from the BALANCE column. A balance before the first row becomes an "Opening balance" credit. Balances that don't add up are listed in the notes. |
| Log lines with TIME OUT (added) | Trips: Ticket number, Departed at, Returned at, Odometer start/end | One trip per ticket (first line with times). Destination = PLACE VISIT (else DESCRIPTION), Purpose = PURPOSE, Remarks = "Passengers: …", Driver = the sheet's DRIVER, Origin = the vehicle's office. Toll rows with that ticket are linked to the trip. Lines without TIME OUT stay out (counted in the notes). |
| `Sheet20` (PO log) DATE, P.O No., VEHICLE, FUEL LITER, ODO, DRIVER, UNIT PRICE (added) | Fuel: PO number, Driver name, Unit price | Merged into the fill-up with the same vehicle, date and liters; otherwise added as a fill-up. |
| Category dates under ENGINE…BODY | — | A last-service summary; nothing to import. |

### Added columns (`--prepare`)

Added only in empty columns, because the logs have balance formulas and merged cells that inserting would break.

| Where | Column | Notes |
|---|---|---|
| RO3 vehicle list, after REMARKS | FUEL TYPE, VEHICLE TYPE | Drop-downs, pre-filled with the guesses above. Correct them where wrong. |
| | START DATE | Start of the current assignment (PAR / driver). |
| | LTO EXPIRY | The registration's expiry date (the old sheet has only the registration date and renewal month). |
| RO3 driver list, after MOBILE No. | LICENSE TYPE | Drop-down: Professional / Non-Professional. |
| Vehicle sheets, column J | PRICE/L | Next to FUEL LITERS; needed on every fill-up (the total is liters × price). |
| Vehicle sheets, after the log's last column | TIME OUT, TIME IN, ODO OUT, ODO IN | Fill only for trips to import; time as `08:30` or `5:30 PM`. |
| `Sheet20` after DRIVER | UNIT PRICE | For PO log rows. |

A blank added column falls back to the guess (fuel/vehicle type) or stays blank, and the dry run lists it.
