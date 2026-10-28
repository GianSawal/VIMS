"""
Phase 15: import DOLE's old spreadsheet data from the standard import workbook (see docs/MIGRATION.md).

The workbook has one sheet per record type; SHEETS below is the single definition of its columns, used both to
write the blank template and to read a filled one. Rows go in sheet order (vehicles before their fuel, etc.).

Safety rules (spec section 11):
- dry run by default: everything runs in one transaction that is rolled back unless commit=True;
- existing records are never overwritten: a matching vehicle/driver only gets its *blank* fields filled
  (counted as "updated"), differing values are kept and reported; other record types are skipped when a
  matching row already exists, so re-running the same workbook creates nothing twice;
- every problem is recorded as an Issue (sheet, row, level, field, message) for the review report;
  an error skips that row only (savepoint per row), a warning imports it with a note.
Historical rows are written with the models directly (full_clean) rather than the live-entry services, because
those check "today" rules (odometer only goes up, open jobs change vehicle status) that old records can't meet.
"""
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from accounts.models import Office
from fleet.documents import EXPIRING_TYPES, SINGLE_ACTIVE
from fleet.models import Driver, Vehicle, VehicleAssignment, VehicleDocument
from maintenance.models import MaintenanceCategory, MaintenanceRecord
from operations.fuel import TOTAL_TOLERANCE
from operations.models import FuelRecord, RFIDAccount, TollTransaction, Trip
from operations.toll import mask_account


class RowError(Exception):
    def __init__(self, field, message, value=None):
        super().__init__(message)
        self.field, self.message, self.value = field, message, value


@dataclass
class Issue:
    sheet: str
    row: int
    level: str      # 'error' (row not imported) or 'warning' (imported, check it)
    field: str
    message: str
    value: str = ''


# ---------------------------------------------------------------- cell parsers (raise RowError on bad input)

def _blank(v):
    return v is None or (isinstance(v, str) and not v.strip())


def text(v, field):
    return '' if _blank(v) else re.sub(r'\s+', ' ', str(v)).strip()


def ident(v, field):
    """Optional unique identifier: trimmed, uppercased, None when blank (like the API serializers)."""
    return text(v, field).upper() or None


DATE_FORMATS = ['%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%d-%b-%Y', '%d %b %Y', '%b %d, %Y', '%B %d, %Y', '%d %B %Y', '%Y/%m/%d']


def a_date(v, field):
    if _blank(v):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = text(v, field)
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise RowError(field, 'Not a date we can read (use YYYY-MM-DD).', s)


def a_datetime(v, field):
    if _blank(v):
        return None
    if isinstance(v, datetime):
        dt = v
    else:
        s = text(v, field)
        for fmt in ('%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M:%S', '%m/%d/%Y %H:%M', '%m/%d/%Y %I:%M %p'):
            try:
                dt = datetime.strptime(s, fmt)
                break
            except ValueError:
                continue
        else:
            dt = datetime.combine(a_date(v, field), time(8, 0))  # date only: assume office hours
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def number(places):
    def parse(v, field):
        if _blank(v):
            return None
        s = re.sub(r'[₱,\s]|PHP', '', str(v), flags=re.I)
        try:
            d = Decimal(s)
        except InvalidOperation:
            raise RowError(field, 'Not a number.', str(v))
        if d < 0:
            raise RowError(field, 'Cannot be negative.', str(v))
        return d.quantize(Decimal(places))
    return parse


money, qty = number('0.01'), number('0.001')


def whole(v, field):
    d = number('1')(v, field)
    return None if d is None else int(d)


def yes_no(v, field):
    return not _blank(v) and text(v, field).lower() in ('y', 'yes', 'true', '1', 'x', 'full')


def choice(choices):
    """Accept a value or its label in any case/punctuation: 'Pick-up' -> PICKUP, 'gsis insurance' -> GSIS_INSURANCE."""
    key = lambda s: re.sub(r'[^a-z0-9]', '', str(s).lower())
    lookup = {key(v): v for v, _ in choices} | {key(label): v for v, label in choices}

    def parse(v, field):
        if _blank(v):
            return None
        found = lookup.get(key(v))
        if not found:
            raise RowError(field, f'Unknown value. Use one of: {", ".join(label for _, label in choices)}.', str(v))
        return found
    parse.choices = choices
    return parse


def plate_key(plate):
    """'abc-123', 'ABC 123' and 'ABC123' are the same plate for matching and duplicate checks."""
    return re.sub(r'[^A-Z0-9]', '', (plate or '').upper())


def name_key(name):
    """'Emilio C. Capollo' == 'EMILIO C CAPOLLO' for matching people."""
    return re.sub(r'[^A-Z0-9 ]', '', re.sub(r'\s+', ' ', (name or '').upper())).strip()


def office_key(name):
    words = re.sub(r'[^a-z0-9 ]', ' ', (name or '').lower()).split()
    return ' '.join(w for w in words if w not in ('dole', 'the', 'of'))


# ---------------------------------------------------------------- the workbook definition

def col(key, parse, required=False, note=''):
    return {'key': key, 'parse': parse, 'required': required, 'note': note}


TRIP_STATUSES = [('COMPLETED', 'Completed'), ('CANCELLED', 'Cancelled')]
JOB_STATUSES = [('COMPLETED', 'Completed'), ('CANCELLED', 'Cancelled')]

SHEETS = {
    'Offices': ('Other spellings of office names used in the old sheets (optional).', [
        col('name_in_old_sheet', text, True, 'Exactly as written in the old spreadsheet'),
        col('office_code', text, True, 'Code of an office already set up in the system, e.g. R03'),
    ]),
    'Vehicles': ('One row per vehicle (the master list). Plate number is the migration identifier.', [
        col('plate_number', text, True), col('property_number', ident), col('make', text, True), col('model', text, True),
        col('variant', text), col('year_model', whole), col('vehicle_type', choice(Vehicle.Type.choices), True),
        col('color', text), col('fuel_type', choice(Vehicle.Fuel.choices), True), col('engine_number', ident),
        col('chassis_number', ident), col('acquisition_date', a_date), col('acquisition_cost', money),
        col('current_odometer', whole, note='Latest reading; raised automatically if fuel/trip rows show a higher one'),
        col('office', text, True, 'Office code or name'), col('status', choice(Vehicle.Status.choices), note='Default: Serviceable'),
        col('remarks', text),
    ]),
    'Drivers': ('One row per driver. Matched to existing drivers by license number, then by name.', [
        col('full_name', text, True), col('employee_number', ident), col('office', text, True),
        col('contact_number', text), col('license_number', ident, True),
        col('license_type', choice(Driver.LicenseType.choices), True), col('license_restrictions', text),
        col('license_issue_date', a_date), col('license_expiry_date', a_date, True),
    ]),
    'Assignments': ('Who was accountable for each vehicle and when. Leave End date blank for the current one.', [
        col('plate_number', text, True), col('office', text, True), col('accountable_person', text, True),
        col('driver_name', text, note='Linked to the driver record when the name matches exactly one driver'),
        col('start_date', a_date, True), col('end_date', a_date), col('remarks', text),
    ]),
    'Documents': ('LTO registration, OR/CR, GSIS insurance and other papers. Several rows per vehicle = history.', [
        col('plate_number', text, True), col('document_type', choice(VehicleDocument.Type.choices), True),
        col('reference_number', text), col('issue_date', a_date), col('expiry_date', a_date, note='Required for LTO, OR and insurance'),
        col('remarks', text),
    ]),
    'Maintenance': ('Completed (or cancelled) maintenance jobs. Enter open jobs in the app instead.', [
        col('plate_number', text, True), col('date', a_date, True), col('odometer', whole), col('reference_number', text),
        col('categories', text, note='Comma-separated, e.g. "Engine, Tires"'), col('description', text, True),
        col('service_provider', text), col('labor_cost', money), col('parts_cost', money),
        col('status', choice(JOB_STATUSES), note='Default: Completed'), col('completed_on', a_date, note='Default: the date'),
        col('remarks', text),
    ]),
    'Fuel': ('Fill-ups, including the Fuel PO log (rows with a PO number).', [
        col('plate_number', text, True), col('date', a_date, True), col('driver_name', text), col('po_number', text),
        col('supplier', text), col('fuel_type', choice(Vehicle.Fuel.choices), note="Default: the vehicle's fuel"),
        col('liters', qty, True), col('unit_price', money, True), col('total_amount', money, note='Default: liters x price'),
        col('odometer', whole, True), col('is_full_tank', yes_no, note='Yes / No'), col('receipt_number', text), col('remarks', text),
    ]),
    'Trips': ('Finished trip tickets only (completed or cancelled), where the old records are reliable.', [
        col('ticket_number', text, True), col('plate_number', text, True), col('driver_name', text, True),
        col('requesting_office', text), col('origin', text, True), col('destination', text, True), col('purpose', text, True),
        col('departed_at', a_datetime, True, 'Date and time, e.g. 2025-03-14 08:30'), col('returned_at', a_datetime),
        col('odometer_start', whole), col('odometer_end', whole), col('status', choice(TRIP_STATUSES), note='Default: Completed'),
        col('remarks', text),
    ]),
    'Toll': ('RFID loads (credit) and toll charges (debit). One of the two per row.', [
        col('provider', choice(RFIDAccount.Provider.choices), True), col('account_number', text, True),
        col('plate_number', text, True), col('transacted_at', a_datetime, True), col('description', text, True),
        col('credit', money, note='Load amount'), col('debit', money, note='Toll charge'), col('reference_number', text),
        col('ticket_number', text, note='Trip ticket, if known'),
    ]),
}


def header(c):
    return c['key'].replace('_', ' ').capitalize() + (' *' if c['required'] else '')


def write_template(path):
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    guide = wb.active
    guide.title = 'Instructions'
    guide.append(['DOLE VRS import workbook'])
    guide['A1'].font = Font(bold=True, size=14)
    for line in ['Fill one sheet per record type; leave a sheet empty to skip it. Columns marked * are required.',
                 'Do not rename sheets or headers. Dates: YYYY-MM-DD. Money: numbers only (no peso sign needed).',
                 'Run the import as a dry run first and review the issues report before importing for real.', '']:
        guide.append([line])
    guide.append(['Sheet', 'Column', 'Required', 'Allowed values / notes'])
    for cell in guide[guide.max_row]:
        cell.font = Font(bold=True)
    for name, (about, cols) in SHEETS.items():
        guide.append([name, about])
        for c in cols:
            allowed = ', '.join(label for _, label in getattr(c['parse'], 'choices', []))
            guide.append(['', header(c).rstrip(' *'), 'Yes' if c['required'] else '', '; '.join(x for x in (allowed, c['note']) if x)])
    for letter, width in zip('ABCD', (14, 24, 10, 90)):
        guide.column_dimensions[letter].width = width
    for name, (about, cols) in SHEETS.items():
        ws = wb.create_sheet(name)
        ws.append([header(c) for c in cols])
        for i, c in enumerate(cols):
            cell = ws.cell(1, i + 1)
            cell.font = Font(bold=True, color='FFFFFF')
            cell.fill = PatternFill('solid', fgColor='0305BA')
            allowed = ', '.join(label for _, label in getattr(c['parse'], 'choices', []))
            if allowed or c['note']:
                cell.comment = Comment('; '.join(x for x in (allowed, c['note']) if x), 'DOLE VRS')
            ws.column_dimensions[cell.column_letter].width = max(14, len(cell.value) + 4)
        ws.freeze_panes = 'A2'
    wb.save(path)


def read_workbook(path):
    """{sheet: [(excel_row_number, {key: raw value})]} for the known sheets; plus problems with the layout."""
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=True, read_only=True)
    out, problems = {}, []
    norm = lambda h: re.sub(r'[^a-z0-9]+', '_', str(h or '').lower()).strip('_')
    for name in wb.sheetnames:
        if name not in SHEETS:
            if name != 'Instructions':
                problems.append(Issue(name, 0, 'warning', '', 'Unknown sheet, ignored.'))
            continue
        rows = wb[name].iter_rows(values_only=True)
        heads = [norm(h) for h in next(rows, [])]
        known = {c['key'] for c in SHEETS[name][1]}
        for h in heads:
            if h and h not in known:
                problems.append(Issue(name, 1, 'warning', h, 'Unknown column, ignored.'))
        missing = [c['key'] for c in SHEETS[name][1] if c['required'] and c['key'] not in heads]
        if missing:
            problems.append(Issue(name, 1, 'error', ', '.join(missing), 'Required column missing; sheet skipped.'))
            continue
        data = []
        for i, values in enumerate(rows, start=2):
            row = {h: v for h, v in zip(heads, values) if h in known}
            if any(not _blank(v) for v in row.values()):
                data.append((i, row))
        out[name] = data
    wb.close()
    return out, problems


# ---------------------------------------------------------------- the import

class Importer:
    def __init__(self, user=None):
        self.user = user
        self.issues = []
        self.counts = defaultdict(Counter)  # sheet -> created/updated/skipped/failed (+ warnings)
        self.office_alias = {}
        self.offices = {}
        for o in Office.objects.all():
            self.offices[o.code.upper()] = o
            self.offices[office_key(o.name)] = o
        self.vehicles = {plate_key(v.plate_number): v for v in Vehicle.objects.filter(is_archived=False)}
        self.drivers_by_license = {d.license_number.upper(): d for d in Driver.objects.all()}
        self.drivers_by_name = defaultdict(list)
        for d in Driver.objects.all():
            self.drivers_by_name[name_key(d.full_name)].append(d)
        self.categories = {c.name.lower(): c for c in MaintenanceCategory.objects.all()}
        self.top_odometer = {}  # vehicle pk -> highest reading seen in imported rows

    # -- bookkeeping
    def issue(self, sheet, row, level, field, message, value=''):
        self.issues.append(Issue(sheet, row, level, field, message, '' if value is None else str(value)))
        if level == 'warning':
            self.counts[sheet]['warnings'] += 1

    def parse(self, sheet, raw):
        out = {}
        for c in SHEETS[sheet][1]:
            v = c['parse'](raw.get(c['key']), c['key'])
            if c['required'] and (v is None or v == ''):
                raise RowError(c['key'], 'Required.')
            out[c['key']] = v
        return out

    # -- lookups shared by the sheets
    def office(self, name, field='office'):
        o = (self.offices.get(name.upper()) or self.offices.get(office_key(name))
             or self.offices.get(self.office_alias.get(office_key(name), '').upper()))
        if not o:
            raise RowError(field, 'Unknown office. Use an office code, or map this spelling on the Offices sheet.', name)
        return o

    def vehicle(self, plate):
        v = self.vehicles.get(plate_key(plate))
        if not v:
            raise RowError('plate_number', 'No vehicle with this plate (add it on the Vehicles sheet).', plate)
        return v

    def driver(self, sheet, row, name, required=False):
        if not name:
            return None
        matches = self.drivers_by_name.get(name_key(name), [])
        if len(matches) == 1:
            return matches[0]
        msg = 'Several drivers have this name' if matches else 'No driver with this name'
        if required:
            raise RowError('driver_name', f'{msg}; add or fix it on the Drivers sheet.', name)
        self.issue(sheet, row, 'warning', 'driver_name', f'{msg}; kept the name as text only.', name)
        return None

    def saw_odometer(self, vehicle, reading):
        if reading is not None:
            self.top_odometer[vehicle.pk] = max(reading, self.top_odometer.get(vehicle.pk, 0))

    # -- run
    def run(self, sheets, commit=False):
        handlers = [('Offices', self.offices_sheet), ('Vehicles', self.vehicles_sheet), ('Drivers', self.drivers_sheet),
                    ('Assignments', self.assignments_sheet), ('Documents', self.documents_sheet),
                    ('Maintenance', self.maintenance_sheet), ('Fuel', self.fuel_sheet), ('Trips', self.trips_sheet),
                    ('Toll', self.toll_sheet)]
        with transaction.atomic():
            for name, handler in handlers:
                rows = []
                for n, raw in sheets.get(name, []):
                    try:
                        rows.append((n, self.parse(name, raw)))
                    except RowError as e:
                        self.fail(name, n, e)
                handler(name, rows)
            self.raise_odometers()
            if not commit:
                transaction.set_rollback(True)
        return self.summary()

    def fail(self, sheet, row, e):
        if isinstance(e, ValidationError):
            msgs = e.message_dict if hasattr(e, 'error_dict') else {'': e.messages}
            for field, messages in msgs.items():
                self.issue(sheet, row, 'error', '' if field == '__all__' else field, ' '.join(messages))
        else:
            self.issue(sheet, row, 'error', e.field, e.message, e.value)
        self.counts[sheet]['failed'] += 1

    def each(self, sheet, rows, fn):
        """Run fn(row_number, data) per row inside a savepoint; it returns 'created' / 'updated' / 'skipped'."""
        for n, data in rows:
            try:
                with transaction.atomic():
                    self.counts[sheet][fn(n, data)] += 1
            except (RowError, ValidationError) as e:
                self.fail(sheet, n, e)

    def create(self, model_class, /, **fields):
        obj = model_class(**fields)
        if hasattr(obj, 'created_by_id') and self.user:
            obj.created_by = self.user
        obj.full_clean()
        obj.save()
        return obj

    def fill_blanks(self, sheet, n, obj, data, label):
        """Fill only empty fields of an existing record; report (never apply) differing values."""
        filled, differ = [], []
        for k, v in data.items():
            current = getattr(obj, k)
            if v in (None, ''):
                continue
            if current in (None, '') or (k == 'current_odometer' and current == 0):
                setattr(obj, k, v)
                filled.append(k)
            elif current != v:
                differ.append(k)
        if differ:
            self.issue(sheet, n, 'warning', ', '.join(differ), f'{label} already exists; kept the values in the system for these fields.')
        if filled:
            obj.full_clean()
            obj.save()
            return 'updated'
        return 'skipped'

    # -- sheets
    def offices_sheet(self, sheet, rows):
        for n, d in rows:
            code = d['office_code'].upper()
            if code not in self.offices:
                self.fail(sheet, n, RowError('office_code', 'No office with this code in the system.', code))
                continue
            self.office_alias[office_key(d['name_in_old_sheet'])] = code  # a lookup, not a record: not counted

    def vehicles_sheet(self, sheet, rows):
        seen = {}

        def one(n, d):
            key = plate_key(d['plate_number'])
            if key in seen:
                raise RowError('plate_number', f'Same plate as row {seen[key]} on this sheet.', d['plate_number'])
            seen[key] = n
            data = {**d, 'plate_number': d['plate_number'].upper(), 'office': self.office(d['office'])}
            existing = self.vehicles.get(key)
            if existing:
                data.pop('status')  # status is operational state; never taken from an old sheet for an existing vehicle
                return self.fill_blanks(sheet, n, existing, data, 'Vehicle')
            data['status'] = data['status'] or Vehicle.Status.SERVICEABLE
            data['current_odometer'] = data['current_odometer'] or 0
            self.vehicles[key] = self.create(Vehicle, **data)
            return 'created'
        self.each(sheet, rows, one)

    def drivers_sheet(self, sheet, rows):
        seen = {}

        def one(n, d):
            lic = d['license_number']
            if lic in seen:
                raise RowError('license_number', f'Same license number as row {seen[lic]} on this sheet.', lic)
            seen[lic] = n
            data = {**d, 'office': self.office(d['office'])}
            existing = self.drivers_by_license.get(lic)
            if not existing:
                same_name = self.drivers_by_name.get(name_key(d['full_name']), [])
                if same_name:
                    self.issue(sheet, n, 'warning', 'full_name', 'A driver with this name but another license number exists; '
                               'created a separate record. Check it is not the same person.', d['full_name'])
            if existing:
                return self.fill_blanks(sheet, n, existing, data, 'Driver')
            drv = self.create(Driver, **data)
            self.drivers_by_license[lic] = drv
            self.drivers_by_name[name_key(drv.full_name)].append(drv)
            return 'created'
        self.each(sheet, rows, one)

    def assignments_sheet(self, sheet, rows):
        # Oldest first per vehicle, so an open (current) row is checked against the closed ones before it.
        rows = sorted(rows, key=lambda r: (plate_key(r[1]['plate_number']), r[1]['start_date']))

        def one(n, d):
            v = self.vehicle(d['plate_number'])
            if d['end_date'] and d['end_date'] < d['start_date']:
                raise RowError('end_date', 'End date is before the start date.', d['end_date'])
            if VehicleAssignment.objects.filter(vehicle=v, start_date=d['start_date']).exists():
                return 'skipped'
            overlap = VehicleAssignment.objects.filter(vehicle=v, start_date__lte=d['end_date'] or date.max)
            overlap = overlap.exclude(end_date__lt=d['start_date'])
            if overlap.exists():
                self.issue(sheet, n, 'warning', 'start_date', 'Overlaps another assignment of this vehicle.', d['start_date'])
            drv = self.driver(sheet, n, d['driver_name'])
            self.create(VehicleAssignment, vehicle=v, office=self.office(d['office']), accountable_person=d['accountable_person'],
                        driver=drv, driver_name=drv.full_name if drv else d['driver_name'], start_date=d['start_date'],
                        end_date=d['end_date'], remarks=d['remarks'])
            return 'created'
        self.each(sheet, rows, one)

    def documents_sheet(self, sheet, rows):
        # Per vehicle and type, the latest expiry becomes ACTIVE and older ones SUPERSEDED (the renewal history),
        # unless the system already has an active one: then imported rows are history only.
        latest = {}
        for n, d in rows:
            k = (plate_key(d['plate_number']), d['document_type'])
            if d['document_type'] in SINGLE_ACTIVE and (k not in latest or (d['expiry_date'] or date.min) >= latest[k][1]):
                latest[k] = (n, d['expiry_date'] or date.min)

        def one(n, d):
            v = self.vehicle(d['plate_number'])
            t = d['document_type']
            if t in EXPIRING_TYPES and not d['expiry_date']:
                raise RowError('expiry_date', 'This document type needs an expiry date.')
            if d['issue_date'] and d['expiry_date'] and d['expiry_date'] < d['issue_date']:
                raise RowError('expiry_date', 'Expiry date is before the issue date.', d['expiry_date'])
            same = VehicleDocument.objects.filter(vehicle=v, document_type=t, expiry_date=d['expiry_date'],
                                                  reference_number=d['reference_number'])
            if same.exists():
                return 'skipped'
            status = VehicleDocument.Status.ACTIVE
            if t in SINGLE_ACTIVE:
                if latest.get((plate_key(d['plate_number']), t), (None,))[0] != n:
                    status = VehicleDocument.Status.SUPERSEDED
                elif VehicleDocument.objects.filter(vehicle=v, document_type=t, status=VehicleDocument.Status.ACTIVE).exists():
                    status = VehicleDocument.Status.SUPERSEDED
                    self.issue(sheet, n, 'warning', 'document_type', 'The vehicle already has an active one in the system; '
                               'imported as history (superseded).')
            self.create(VehicleDocument, vehicle=v, document_type=t, reference_number=d['reference_number'],
                        issue_date=d['issue_date'], expiry_date=d['expiry_date'], status=status, remarks=d['remarks'])
            return 'created'
        self.each(sheet, rows, one)

    def maintenance_sheet(self, sheet, rows):
        def one(n, d):
            v = self.vehicle(d['plate_number'])
            if MaintenanceRecord.objects.filter(vehicle=v, date=d['date'], description=d['description']).exists():
                return 'skipped'
            cats = []
            for name in filter(None, (x.strip() for x in (d['categories'] or '').split(','))):
                cat = self.categories.get(name.lower())
                if not cat:
                    self.issue(sheet, n, 'warning', 'categories', 'Unknown category; filed under Other.', name)
                    cat = self.categories.get('other')
                if cat and cat not in cats:
                    cats.append(cat)
            status = d['status'] or MaintenanceRecord.Status.COMPLETED
            done = status == MaintenanceRecord.Status.COMPLETED
            record = self.create(MaintenanceRecord, vehicle=v, date=d['date'], odometer=d['odometer'],
                                 reference_number=d['reference_number'], description=d['description'],
                                 service_provider=d['service_provider'], labor_cost=d['labor_cost'] or 0,
                                 parts_cost=d['parts_cost'] or 0, status=status,
                                 completed_on=(d['completed_on'] or d['date']) if done else None, remarks=d['remarks'])
            record.categories.set(cats)
            self.saw_odometer(v, d['odometer'])
            return 'created'
        self.each(sheet, rows, one)

    def fuel_sheet(self, sheet, rows):
        def one(n, d):
            v = self.vehicle(d['plate_number'])
            if FuelRecord.objects.filter(vehicle=v, date=d['date'], odometer=d['odometer'], liters=d['liters']).exists():
                return 'skipped'
            computed = (d['liters'] * d['unit_price']).quantize(Decimal('0.01'))
            total = d['total_amount'] if d['total_amount'] is not None else computed
            if abs(total - computed) > TOTAL_TOLERANCE:
                self.issue(sheet, n, 'warning', 'total_amount', f'Differs from liters x price ({computed}); kept the amount given.', total)
            fuel_type = d['fuel_type'] or v.fuel_type
            if fuel_type != v.fuel_type:
                self.issue(sheet, n, 'warning', 'fuel_type', f'Vehicle is registered as {v.get_fuel_type_display()}.', fuel_type)
            self.create(FuelRecord, vehicle=v, date=d['date'], driver=self.driver(sheet, n, d['driver_name']),
                        po_number=d['po_number'], supplier=d['supplier'], fuel_type=fuel_type, liters=d['liters'],
                        unit_price=d['unit_price'], total_amount=total, odometer=d['odometer'], is_full_tank=d['is_full_tank'],
                        receipt_number=d['receipt_number'], remarks=d['remarks'])
            self.saw_odometer(v, d['odometer'])
            return 'created'
        self.each(sheet, rows, one)

    def trips_sheet(self, sheet, rows):
        def one(n, d):
            if Trip.objects.filter(ticket_number=d['ticket_number']).exists():
                return 'skipped'
            v = self.vehicle(d['plate_number'])
            status = d['status'] or Trip.Status.COMPLETED
            if status == Trip.Status.COMPLETED:
                missing = [k for k in ('returned_at', 'odometer_start', 'odometer_end') if d[k] is None]
                if missing:
                    raise RowError(missing[0], 'A completed trip needs its return time and both odometer readings.')
            if d['returned_at'] and d['returned_at'] < d['departed_at']:
                raise RowError('returned_at', 'Return is before departure.', d['returned_at'])
            if d['odometer_end'] is not None and d['odometer_start'] is not None and d['odometer_end'] < d['odometer_start']:
                raise RowError('odometer_end', 'Ending odometer is below the starting one.', d['odometer_end'])
            requesting = self.office(d['requesting_office'], 'requesting_office') if d['requesting_office'] else None
            self.create(Trip, ticket_number=d['ticket_number'], vehicle=v, driver=self.driver(sheet, n, d['driver_name'], required=True),
                        requesting_office=requesting, origin=d['origin'], destination=d['destination'], purpose=d['purpose'],
                        departed_at=d['departed_at'], returned_at=d['returned_at'], odometer_start=d['odometer_start'],
                        odometer_end=d['odometer_end'], status=status, remarks=d['remarks'])
            self.saw_odometer(v, d['odometer_end'])
            return 'created'
        self.each(sheet, rows, one)

    def toll_sheet(self, sheet, rows):
        def one(n, d):
            v = self.vehicle(d['plate_number'])
            credit, debit = d['credit'] or Decimal('0'), d['debit'] or Decimal('0')
            if bool(credit) == bool(debit):
                raise RowError('credit', 'Fill exactly one of Credit (load) or Debit (toll charge).')
            number = d['account_number'].replace(' ', '')
            account = RFIDAccount.objects.filter(provider=d['provider'], account_number=number).first()
            if not account:
                account = self.create(RFIDAccount, provider=d['provider'], account_number=number, vehicle=v)
                self.issue(sheet, n, 'warning', 'account_number', 'New RFID account created for this vehicle.', mask_account(number))
            if TollTransaction.objects.filter(account=account, transacted_at=d['transacted_at'], credit=credit, debit=debit,
                                              description=d['description']).exists():
                return 'skipped'
            trip = Trip.objects.filter(ticket_number=d['ticket_number']).first() if d['ticket_number'] else None
            if d['ticket_number'] and not trip:
                self.issue(sheet, n, 'warning', 'ticket_number', 'No trip with this ticket; saved without a trip link.', d['ticket_number'])
            self.create(TollTransaction, account=account, vehicle=v, trip=trip, transacted_at=d['transacted_at'],
                        description=d['description'], credit=credit, debit=debit, reference_number=d['reference_number'])
            return 'created'
        self.each(sheet, rows, one)

    def raise_odometers(self):
        for v in Vehicle.objects.filter(pk__in=self.top_odometer):
            top = self.top_odometer[v.pk]
            if top > v.current_odometer:
                self.issue('Vehicles', 0, 'warning', 'current_odometer',
                           f'{v.plate_number}: odometer raised from {v.current_odometer:,} to {top:,} (highest imported reading).')
                v.current_odometer = top
                v.save(update_fields=['current_odometer', 'updated_at'])

    def summary(self):
        cols = ('created', 'updated', 'skipped', 'failed', 'warnings')
        return {name: {k: self.counts[name][k] for k in cols} for name in SHEETS if name in self.counts}


def write_report(path, source, summary, issues, committed):
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = 'Summary'
    ws.append([f'Import {"COMMITTED" if committed else "DRY RUN (nothing saved)"}: {source}'])
    ws['A1'].font = Font(bold=True, size=13)
    ws.append([f'Run at {timezone.localtime():%Y-%m-%d %H:%M}'])
    ws.append([])
    ws.append(['Sheet', 'Created', 'Updated', 'Skipped (already there)', 'Failed', 'Warnings'])
    for cell in ws[ws.max_row]:
        cell.font = Font(bold=True)
    for name, c in summary.items():
        ws.append([name, c['created'], c['updated'], c['skipped'], c['failed'], c['warnings']])
    ws.column_dimensions['A'].width = 16
    rv = wb.create_sheet('Issues')
    rv.append(['Sheet', 'Row', 'Level', 'Field', 'Message', 'Value', 'Reviewed by / action'])
    for cell in rv[1]:
        cell.font = Font(bold=True)
    for i in sorted(issues, key=lambda i: (list(SHEETS).index(i.sheet) if i.sheet in SHEETS else 99, i.row, i.level)):
        rv.append([i.sheet, i.row or '', i.level, i.field, i.message, i.value, ''])
    for letter, width in zip('ABCDEFG', (13, 6, 9, 20, 70, 24, 24)):
        rv.column_dimensions[letter].width = width
    rv.freeze_panes = 'A2'
    wb.save(path)
