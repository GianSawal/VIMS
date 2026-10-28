"""
The VEHICLE RECORD form filled with what is in the system (the reverse of legacy.convert).

Starts from the blank form (forms/vehicle-record-form.xlsx, RO3's own layout) and writes:
- RO3: one row per vehicle (current assignment, GSIS / LTO, EasyTrip account) and the driver list;
- one sheet per vehicle, a copy of the PLATE NO sheet named after the plate: vehicle info, last service per category,
  completed maintenance, fill-ups, and the RFID / trip log (toll rows and completed trips in time order);
- Sheet20: fill-ups with a PO number.
Each section needs its own view permission and only the user's offices are included, like the rest of the API.
It is a report in the familiar layout, not a re-import file: the old layout has no toll times or document
reference numbers, so re-importing it into the same system would duplicate those rows.
"""
import io
import re
from copy import copy

from django.utils.timezone import localtime
from openpyxl import load_workbook
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.hyperlink import Hyperlink

from accounts.permissions import scope_to_offices
from fleet.models import Driver, Vehicle, VehicleAssignment, VehicleDocument
from maintenance.models import MaintenanceRecord
from operations.models import FuelRecord, RFIDAccount, TollTransaction, Trip
from operations.toll import mask_account

from .legacy import FORM, FORM_SHEET, NEW_DRIVER, PO_PRICE, header_cols, log_row, maint_row, master_rows, po_row

CATEGORY_COLUMNS = {'ENGINE': 'Engine', 'TIRE': 'Tires', 'BRAKES': 'Brakes', 'AIRCON': 'Air Conditioning',
                    'BATTERY': 'Battery', 'BODY': 'Body'}  # row 1 labels of a vehicle sheet -> category


def sheet_title(plate, taken):
    title = re.sub(r'[\[\]:*?/\\]', '-', plate)[:31]
    while title in taken:
        title = title[:28] + '~' + str(len(taken))
    return title


def ensure_rows(ws, first, count, style_row):
    """Make sure rows first..first+count-1 exist with the look of `style_row` (rows below `first` are formatted
    already up to the form's size; extra ones copy the last formatted row)."""
    for r in range(first, first + count):
        if r > style_row:
            for c in range(1, ws.max_column + 1):
                ws.cell(r, c)._style = copy(ws.cell(style_row, c)._style)
            ws.row_dimensions[r].height = ws.row_dimensions[style_row].height


def export_form(user, office=None):
    """Bytes of the filled form for `user` (optionally one office id)."""
    can = user.has_perm
    vehicles = scope_to_offices(Vehicle.objects.filter(is_archived=False), user, 'office').select_related('office')
    if office:
        vehicles = vehicles.filter(office_id=office)
    vehicles = list(vehicles.order_by('office__code', 'plate_number'))
    wb = load_workbook(FORM)
    ro3, form = wb['RO3'], wb[FORM_SHEET]
    head, dhead = master_rows(ro3)
    cols = header_cols(ro3, head)

    # RO3 vehicle list: the form has room up to the AUTHORIZED DRIVER block; insert rows if there are more vehicles.
    room = (dhead - 2) - head - 1  # leaves the blank row and the AUTHORIZED DRIVER title row in place
    if len(vehicles) > room:
        extra = len(vehicles) - room
        ro3.insert_rows(dhead - 2, extra)  # no merges or formulas on RO3; data validations are re-added below
        for r in range(dhead - 2, dhead - 2 + extra):
            for c in range(1, ro3.max_column + 1):
                ro3.cell(r, c)._style = copy(ro3.cell(head + 1, c)._style)
        dhead += extra
    ro3.data_validations.dataValidation = []

    def put(ws, r, cols, name, value):
        if name in cols and value not in (None, ''):
            write(ws.cell(r, cols[name]), value)

    taken = set(wb.sheetnames)
    see = {'docs': can('fleet.view_vehicledocument'), 'assign': can('fleet.view_vehicleassignment'),
           'rfid': can('operations.view_rfidaccount'), 'toll': can('operations.view_tolltransaction'),
           'trips': can('operations.view_trip'), 'fuel': can('operations.view_fuelrecord'),
           'maint': can('maintenance.view_maintenancerecord'), 'drivers': can('fleet.view_driver')}
    full_account = can('operations.change_rfidaccount')
    po_rows = []
    for i, v in enumerate(vehicles, start=1):
        r = head + i
        assignment = (VehicleAssignment.objects.filter(vehicle=v, end_date__isnull=True).order_by('-start_date').first()
                      if see['assign'] else None)
        docs = {d.document_type: d for d in VehicleDocument.objects.filter(vehicle=v, status=VehicleDocument.Status.ACTIVE)} if see['docs'] else {}
        gsis, lto = docs.get('GSIS_INSURANCE'), docs.get('LTO_REGISTRATION')
        account = RFIDAccount.objects.filter(vehicle=v, is_active=True).first() if see['rfid'] else None
        title = sheet_title(v.plate_number, taken)
        taken.add(title)
        for name, value in [
            ('NO.', i), ('OFFICE', v.office.name), ('VEHICLE', ' '.join(x for x in (v.make, v.model, v.variant) if x)),
            ('COLOR', v.color), ('PN', v.plate_number),
            ('EASYTRIP', account and (account.account_number if full_account else mask_account(account.account_number))),
            ('GSIS', gsis and gsis.expiry_date), ('LTO', lto and lto.issue_date),
            ('RENEW DATE', lto and lto.expiry_date and lto.expiry_date.strftime('%B').upper()),
            ('PAR', assignment and assignment.accountable_person), ('DRIVER', assignment and assignment.driver_name),
            ('REMARKS', v.get_status_display().upper()), ('FUEL TYPE', v.get_fuel_type_display()),
            ('VEHICLE TYPE', v.get_vehicle_type_display()), ('START DATE', assignment and assignment.start_date),
            ('LTO EXPIRY', lto and lto.expiry_date)]:
            put(ro3, r, cols, name, value)
        pn = ro3.cell(r, cols['PN'])
        pn.hyperlink = Hyperlink(ref=pn.coordinate, location=f"'{title}'!A1")  # like the old workbook: the plate opens its sheet

        ws = wb.copy_worksheet(form)
        ws.title = title
        fill_vehicle_sheet(ws, v, assignment, see, po_rows)

    for name, choices in (('FUEL TYPE', Vehicle.Fuel.choices), ('VEHICLE TYPE', Vehicle.Type.choices)):
        add_dropdown(ro3, cols[name], head + 1, head + max(len(vehicles), room), choices)

    # Driver list.
    dcols = header_cols(ro3, dhead)
    drivers = list(scope_to_offices(Driver.objects.filter(is_active=True), user, 'office').select_related('office')
                   .order_by('full_name')) if see['drivers'] else []
    if office:
        drivers = [d for d in drivers if d.office_id == int(office)]
    ensure_rows(ro3, dhead + 1, len(drivers), ro3.max_row)
    for i, d in enumerate(drivers, start=1):
        for name, value in [('NO.', i), ('DRIVER', d.full_name), ('LICENSE NUMBER', d.license_number),
                            ('EXP.DATE', d.license_expiry_date), ('PLACE', d.office.name), ('MOBILE NO.', d.contact_number),
                            ('LICENSE TYPE', d.get_license_type_display())]:
            put(ro3, dhead + i, dcols, name, value)
    add_dropdown(ro3, dcols[NEW_DRIVER[0]], dhead + 1, max(ro3.max_row, dhead + 1), Driver.LicenseType.choices)

    # Sheet20 PO log.
    po = wb['Sheet20']
    prow = po_row(po)
    pcols = header_cols(po, prow)
    ensure_rows(po, prow + 1, len(po_rows), prow + 1)
    for i, f in enumerate(po_rows, start=1):
        for name, value in [('DATE', f.date), ('P.O NO.', f.po_number), ('VEHICLE', f.vehicle.plate_number),
                            ('FUEL LITER', float(f.liters)), ('ODO', f.odometer), ('DRIVER', f.driver and f.driver.full_name),
                            (PO_PRICE, float(f.unit_price))]:
            put(po, prow + i, pcols, name, value)

    if vehicles:
        wb.remove(form)  # every vehicle has its own copy; an empty form stays only when there are none
    wb.calculation.fullCalcOnLoad = True  # the form's remaining balance formulas get values when Excel opens it
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), len(vehicles)


def write(cell, value):
    """Set a value; text wraps inside its column instead of running over the empty cells beside it."""
    cell.value = value
    if isinstance(value, str):
        alignment = copy(cell.alignment)
        alignment.wrap_text = True
        cell.alignment = alignment


def place(text):
    """'Royce Hotel and Casino, Clark, Pampanga, ...' -> 'Royce Hotel and Casino' (map addresses are long)."""
    return (text or '').split(',')[0].strip()


def add_dropdown(ws, col, first, last, choices):
    dv = DataValidation(type='list', formula1='"' + ','.join(label for _, label in choices) + '"', allow_blank=True)
    ws.add_data_validation(dv)
    letter = ws.cell(1, col).column_letter
    dv.add(f'{letter}{first}:{letter}{last}')


def fill_vehicle_sheet(ws, v, assignment, see, po_rows):
    labels = {}
    for r in range(1, 9):
        label = str(ws.cell(r, 1).value or '').upper()
        if label.endswith(':'):
            labels[label.rstrip(' :')] = r
    for label, value in (('VEHICLE', f'{v.make} {v.model}'), ('COLOR', v.color), ('PLATE NO.', v.plate_number),
                         ('DRIVER', assignment and assignment.driver_name), ('OFFICE', v.office.name)):
        if label in labels and value:
            ws.cell(labels[label], 2).value = value

    mrow, lrow = maint_row(ws), log_row(ws)
    jobs = list(MaintenanceRecord.objects.filter(vehicle=v, status=MaintenanceRecord.Status.COMPLETED)
                .prefetch_related('categories').order_by('date', 'id')) if see['maint'] else []
    # Row 1 ENGINE..BODY with the last service date under each, as in the old sheets.
    for c in range(1, 12):
        category = CATEGORY_COLUMNS.get(str(ws.cell(1, c).value or '').upper())
        done = [j.completed_on or j.date for j in jobs if any(cat.name == category for cat in j.categories.all())]
        if category and done:
            ws.cell(2, c).value = max(done)

    fuel = list(FuelRecord.objects.filter(vehicle=v).select_related('driver', 'vehicle').order_by('date', 'id')) if see['fuel'] else []
    ensure_rows(ws, mrow + 1, max(len(jobs), len(fuel)), ws.max_row)
    for i, j in enumerate(jobs, start=mrow + 1):
        for c, value in enumerate([j.date, j.reference_number, j.description, j.service_provider, float(j.total_cost)], start=1):
            if value not in (None, ''):
                write(ws.cell(i, c), value)
    for i, f in enumerate(fuel, start=mrow + 1):
        for c, value in zip((7, 8, 9, 10), (f.date, f.odometer, float(f.liters), float(f.unit_price))):
            ws.cell(i, c).value = value
        if f.po_number:
            po_rows.append(f)

    # RFID / trip log: toll rows and completed trips, in time order; BALANCE stays a running formula.
    cols = header_cols(ws, lrow)
    lines = []
    if see['toll']:
        for t in TollTransaction.objects.filter(vehicle=v).select_related('trip'):
            lines.append((t.transacted_at, 1, {'DATE': localtime(t.transacted_at).date(), 'DESCRIPTION': t.description,
                                               'TRIP TICKET NO.': t.trip.ticket_number if t.trip else t.reference_number,
                                               'CREDIT': float(t.credit) or None, 'DEBIT': float(t.debit) or None}))
    if see['trips']:
        for t in Trip.objects.filter(vehicle=v, status=Trip.Status.COMPLETED).exclude(departed_at=None):
            lines.append((t.departed_at, 0, {
                'DATE': localtime(t.departed_at).date(), 'TRIP TICKET NO.': t.ticket_number, 'DESCRIPTION': f'{place(t.origin)} - {place(t.destination)}',
                'PASSENGER': t.passengers, 'PLACE VISIT': t.destination, 'PURPOSE': t.purpose,
                'TIME OUT': localtime(t.departed_at).time().replace(second=0, microsecond=0),
                'TIME IN': t.returned_at and localtime(t.returned_at).time().replace(second=0, microsecond=0),
                'ODO OUT': t.odometer_start, 'ODO IN': t.odometer_end}))
    lines.sort(key=lambda x: (x[0], x[1]))
    ensure_rows(ws, lrow + 1, len(lines), ws.max_row)
    # BALANCE as numbers, not formulas: openpyxl can't store a formula's result, so a formula shows blank until Excel
    # recalculates (not in Protected View or other viewers). Same running total as the app: credits minus debits in time order.
    running = 0
    for r, (_, _, line) in enumerate(lines, start=lrow + 1):
        for name, value in line.items():
            if name in cols and value not in (None, ''):
                write(ws.cell(r, cols[name]), value)
        running = round(running + (line.get('CREDIT') or 0) - (line.get('DEBIT') or 0), 2)
        if 'BALANCE' in cols:
            ws.cell(r, cols['BALANCE']).value = running  # the form's formulas below (=P{r-1}+N{r}-O{r}) continue from it
