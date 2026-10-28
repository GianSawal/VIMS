"""
Phase 15: convert DOLE RO3's old workbook (DATA/VEHICLE RECORD.xlsx) into the standard import workbook.

Old layout:
- sheet RO3: the vehicle master list (rows under the "No. / OFFICE / VEHICLE ..." header) and the authorized
  driver list (rows under "AUTHORIZED DRIVER");
- one sheet per vehicle, three blocks side by side: maintenance (A-E), fuel and odometer readings (G-I) and the
  RFID / trip log (from column K; its columns are found by header name because their order differs per sheet).

The output is a normal filled template: review it, then dry-run and import it with import_workbook. Values the old
workbook does not have (fuel prices, assignment start dates, license types, LTO expiry) are left blank so the dry
run lists them; everything the converter inferred or could not use is listed on the "Conversion notes" sheet.
The EasyTrip USERNAME / PW columns are never read: the system stores no third-party credentials.
"""
import re
from datetime import date, datetime, time, timedelta

from openpyxl import load_workbook

from .importer import NOTES_SHEET, SHEETS, name_key, plate_key, write_template

# Old spellings (RO3 OFFICE column, driver PLACE column) -> office code. Written to the Offices sheet for review.
OFFICE_ALIASES = {
    'REGIONAL DIRECTOR': 'ORD', 'ORD': 'ORD', 'ARD': 'ARD', 'OARD': 'ARD',
    'REGIONAL OFFICE': 'R03', 'REGIONAL OFFICE III': 'R03', 'RO': 'R03', 'TSSD1': 'R03', 'TSSD2': 'R03', 'MALSU': 'R03',
    'ZAMBALES': 'ZAM', 'ZAM FO': 'ZAM', 'AURORA': 'AUR', 'AU FO': 'AUR', 'BULACAN': 'BUL', 'BUL FO': 'BUL',
    'NUEVA ECIJA': 'NE', 'NE FO': 'NE', 'N.E FO': 'NE', 'BATAAN': 'BAT', 'BAT FO': 'BAT',
    'TARLAC': 'TAR', 'TAR FO': 'TAR', 'PAMP FO': 'PAMP',
}
# Inferred from the model name; anything else is left blank for the reviewer.
VANS = ('HIACE', 'HI ACE', 'L300', 'TRAVIS')
SUVS = ('INNOVA', 'CROSSWIND', 'ADVENTURE', 'REVO', 'SPORTIVO')
DIESEL_ONLY = ('DIESEL', 'DSL', 'HIACE', 'HI ACE', 'L300', 'TRAVIS', 'CROSSWIND')  # models sold here as diesel only
CATEGORY_WORDS = [('PMS', 'Preventive Maintenance'), ('CHANGE OIL', 'Preventive Maintenance'), ('TIRE', 'Tires'),
                  ('BATTERY', 'Battery'), ('AIRCON', 'Air Conditioning'), ('BRAKE', 'Brakes'), ('ENGINE', 'Engine')]
PMS_KM = re.compile(r'PMS\s*\(?\s*([\d,]{3,})\s*(?:KM)?\s*\)?', re.I)  # "PMS (1622)", "PMS 1,287 KM"; not "1000 PMS"
PLATE_LIKE = re.compile(r'\b([A-Z]{3}\s?-?\d{3,4})\b')  # sheet titles carry an earlier plate, e.g. "... PLATE No. SCD2797"


def clean(v):
    return re.sub(r'\s+', ' ', str(v)).strip() if v not in (None, '') else ''


def to_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = clean(v).replace('Sept', 'Sep')
    for fmt in ('%d-%b-%Y', '%m/%d/%Y', '%Y-%m-%d', '%B %d, %Y', '%b %d, %Y'):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def to_num(v):
    return round(float(v), 2) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def has(text, words):
    return any(w in text.upper() for w in words)


class Converter:
    def __init__(self, path):
        self.wb = load_workbook(path, data_only=True)
        self.rows = {name: [] for name in SHEETS}
        self.notes = []
        self.aliases = set()

    def note(self, sheet, row, message):
        self.notes.append((sheet, row, message))

    def office(self, name):
        name = clean(name)
        if name.upper() in OFFICE_ALIASES:
            self.aliases.add(name.upper())
        return name

    # ------------------------------------------------------------ RO3: master list and drivers
    def master(self):
        ws = self.wb['RO3']
        head = drivers_head = None
        for r in range(1, ws.max_row + 1):
            a, b = clean(ws.cell(r, 1).value), clean(ws.cell(r, 2).value)
            if a == 'No.' and b == 'OFFICE':
                head = r
            elif a == 'No.' and b == 'DRIVER':
                drivers_head = r
        if not head:
            raise ValueError('Sheet RO3 has no "No. / OFFICE" header row.')
        cols = {clean(c.value).upper(): c.column for c in ws[head] if c.value}
        cell = lambda r, name: ws.cell(r, cols[name]).value if name in cols else None
        vehicles = {}
        for r in range(head + 1, drivers_head or ws.max_row + 1):
            plate = clean(cell(r, 'PN')).upper()
            if not plate:
                continue
            vehicles[plate_key(plate)] = {
                'row': r, 'plate': plate, 'office': self.office(cell(r, 'OFFICE')), 'desc': clean(cell(r, 'VEHICLE')).upper(),
                'color': clean(cell(r, 'COLOR')), 'easytrip': clean(cell(r, 'EASYTRIP')).replace(' ', ''),
                'gsis': to_date(cell(r, 'GSIS')), 'lto': to_date(cell(r, 'LTO')), 'renew': clean(cell(r, 'RENEW DATE')),
                'par': clean(cell(r, 'PAR')), 'driver': clean(cell(r, 'DRIVER')), 'status': clean(cell(r, 'REMARKS')),
            }
        drivers = []
        if drivers_head:
            dcols = {clean(c.value).upper(): c.column for c in ws[drivers_head] if c.value}
            dcell = lambda r, name: ws.cell(r, dcols[name]).value if name in dcols else None
            for r in range(drivers_head + 1, ws.max_row + 1):
                name = clean(dcell(r, 'DRIVER'))
                if name:
                    drivers.append({'row': r, 'name': name, 'license': clean(dcell(r, 'LICENSE NUMBER')),
                                    'expiry': to_date(dcell(r, 'EXP.DATE')), 'office': self.office(dcell(r, 'PLACE')),
                                    'mobile': clean(dcell(r, 'MOBILE NO.'))})
        return vehicles, drivers

    def match_driver(self, name, drivers):
        """'CALONG, FRANCISCO JR. ZAMORA' or 'NIKKO FERRER' -> the driver list's spelling, when exactly one matches
        on surname + first given name."""
        if ',' in name:
            surname, rest = name.split(',', 1)
            first = (name_key(rest).split() or [''])[0]
        else:
            words = [w for w in name_key(name).split() if w not in ('JR', 'SR', 'III')]
            first, surname = (words[0], words[-1]) if words else ('', '')
        surname = name_key(surname)
        found = [d['name'] for d in drivers if {first, surname} <= set(name_key(d['name']).split())]
        return found[0] if len(found) == 1 else None

    # ------------------------------------------------------------ per-vehicle sheets
    def vehicle_sheets(self, vehicles):
        """{plate key: worksheet}, matched by the sheet's PLATE NO. cell, else by the sheet name."""
        found = {}
        for ws in self.wb.worksheets:
            if ws.title == 'RO3' or not any(clean(ws.cell(r, 1).value).startswith('PLATE NO') for r in range(1, 10)):
                continue
            plate = next(clean(ws.cell(r, 2).value) for r in range(1, 10) if clean(ws.cell(r, 1).value).startswith('PLATE NO'))
            key = plate_key(plate) if plate_key(plate) in vehicles else plate_key(ws.title)
            if key not in vehicles:
                self.note(ws.title, '', f'Sheet not on the RO3 master list (plate "{plate}"); not converted.')
                continue
            if plate and plate_key(plate) != key:
                self.note(ws.title, '', f'PLATE NO. cell says "{plate}" but the sheet name and RO3 say {vehicles[key]["plate"]}; '
                          f'used {vehicles[key]["plate"]}. Check which is right.')
            found[key] = ws
        return found

    def header_row(self, ws, test):
        return next((r for r in range(1, 13) if test([clean(c.value).upper() for c in ws[r]])), None)

    def maintenance_and_fuel(self, ws, plate):
        """Returns the highest odometer reading seen on the sheet."""
        head = self.header_row(ws, lambda vals: 'PR NO.' in vals)
        top = 0
        if not head:
            return top
        for r in range(head + 1, ws.max_row + 1):
            when, ref, desc, supplier, cost = (ws.cell(r, c).value for c in range(1, 6))
            desc = clean(desc)
            if desc and desc.upper() != 'DESCRIPTION':
                day = to_date(when)
                if not day:
                    self.note(ws.title, r, f'Maintenance "{desc[:40]}" has no readable date; row left out.')
                else:
                    odo = PMS_KM.search(desc)
                    odo = int(odo.group(1).replace(',', '')) if odo else None
                    free = isinstance(cost, str) and cost.strip().upper() == 'FREE'
                    cats = sorted({cat for word, cat in CATEGORY_WORDS if word in desc.upper()})
                    self.rows['Maintenance'].append({
                        'plate_number': plate, 'date': day, 'odometer': odo, 'reference_number': clean(ref),
                        'categories': ', '.join(cats), 'description': desc, 'service_provider': clean(supplier),
                        'parts_cost': to_num(cost) or 0, 'remarks': 'Free of charge (old sheet)' if free else ''})
                    top = max(top, odo or 0)
            day, odo, liters = to_date(ws.cell(r, 7).value), to_num(ws.cell(r, 8).value), to_num(ws.cell(r, 9).value)
            if odo:
                top = max(top, int(odo))
            if day and liters:
                self.rows['Fuel'].append({'plate_number': plate, 'date': day, 'liters': liters,
                                          'odometer': int(odo) if odo else None})
        return top

    def toll_log(self, ws, plate, account):
        head = self.header_row(ws, lambda vals: 'DATE' in vals[10:] and ('CREDIT' in vals or 'DEBIT' in vals))
        if not head:
            return
        cols = {}
        for c in ws[head]:
            cols.setdefault(clean(c.value).upper(), c.column)  # first one wins (SCC1115 has PURPOSE twice)
        get = lambda r, name: ws.cell(r, cols[name]).value if name in cols else None
        prev_bal = opening = last_day = None
        seq, emitted, trip_lines = {}, 0, 0

        def emit(r, day, desc, credit, debit, ticket):
            nonlocal emitted
            if not account:
                self.note(ws.title, r, 'Toll row but the vehicle has no EASYTRIP number on RO3; row left out.')
                return
            n = seq[day] = seq.get(day, -1) + 1  # keeps same-day rows distinct and in sheet order
            self.rows['Toll'].append({
                'provider': 'Easytrip', 'account_number': account, 'plate_number': plate,
                'transacted_at': datetime.combine(day, time(8, 0)) + timedelta(minutes=n), 'description': desc[:200],
                'credit': credit or None, 'debit': debit or None, 'reference_number': ticket})
            emitted += 1

        for r in range(head + 1, ws.max_row + 1):
            raw_credit = get(r, 'CREDIT')
            label = clean(raw_credit).upper() if isinstance(raw_credit, str) else ''
            credit, debit, bal = to_num(raw_credit), to_num(get(r, 'DEBIT')), to_num(get(r, 'BALANCE'))
            debit = abs(debit) if debit else debit  # one sheet writes charges as negatives
            day = to_date(get(r, 'DATE'))
            desc, ticket = clean(get(r, 'DESCRIPTION')), clean(get(r, 'TRIP TICKET NO.'))
            reload = None
            if label and 'RELOAD' in label and not debit and bal is None:
                self.note(ws.title, r, f'"{clean(raw_credit)}" written without an amount or balance; row left out.')
                continue
            if label and 'RELOAD' in label:
                if 'TOLL' not in label:  # "RELOAD" with the amount in the DEBIT column
                    credit, debit = debit, None
                else:  # "Toll/Reload 500": a load and a charge on one line
                    m = re.search(r'(\d[\d,]*)', label)
                    reload = float(m.group(1).replace(',', '')) if m else (
                        round(bal - prev_bal + (debit or 0), 2) if bal is not None and prev_bal is not None else None)
            if not credit and not debit and not reload:
                if bal and prev_bal is None and not emitted:
                    opening = bal  # balance carried in from before the log starts
                elif any(get(r, k) for k in ('PASSENGER', 'PLACE VISIT', 'PURPOSE')) or ticket:
                    trip_lines += 1
                if bal is not None:
                    prev_bal = bal
                continue
            if not day:
                day = last_day
                self.note(ws.title, r, f'No date; used the row above ({day}).' if day else 'No date and none above; row left out.')
                if not day:
                    continue
            last_day = day
            if opening:
                emit(r, day, 'Opening balance carried over from the old spreadsheet', opening, None, '')
                prev_bal, opening = opening, None
            desc = desc or ('RFID load' if credit or reload else 'Toll')
            if reload:
                emit(r, day, f'RFID load ({label.title()})', reload, None, ticket)
            if credit or debit:
                emit(r, day, desc, credit, debit, ticket)
            expected = (prev_bal or 0) + (credit or 0) + (reload or 0) - (debit or 0)
            if bal is not None and prev_bal is not None and abs(expected - bal) > 0.05:  # the sheets drift by a centavo
                self.note(ws.title, r, f'Balance in the sheet is {bal:,.2f} but the rows above give {expected:,.2f} '
                          '(a load or charge is missing in the old log).')
            if bal is not None:
                prev_bal = bal
        if trip_lines:
            self.note(ws.title, '', f'{trip_lines} trip log line(s) (passenger / place / purpose) not converted: the old log '
                      'has no departure and return times or odometer readings, which a completed trip needs.')

    # ------------------------------------------------------------ run
    def run(self):
        vehicles, drivers = self.master()
        sheets = self.vehicle_sheets(vehicles)
        for d in drivers:
            self.rows['Drivers'].append({
                'full_name': d['name'], 'office': d['office'], 'contact_number': d['mobile'],
                'license_number': d['license'], 'license_expiry_date': d['expiry']})
        for key, v in vehicles.items():
            ws, words = sheets.get(key), v['desc'].split()
            top = 0
            remarks = []
            if ws:
                title = ' '.join(clean(c.value).upper() for c in ws[1] if isinstance(c.value, str))
                other = {p for p in PLATE_LIKE.findall(title) if plate_key(p) != key}
                if other:
                    remarks.append(f'Other plate in the old sheet: {", ".join(sorted(other))}')
                top = self.maintenance_and_fuel(ws, v['plate'])
                self.toll_log(ws, v['plate'], v['easytrip'])
            self.rows['Vehicles'].append({
                'plate_number': v['plate'], 'make': words[0] if words else '', 'model': words[1] if len(words) > 1 else '',
                'variant': ' '.join(words[2:]), 'color': v['color'], 'office': v['office'], 'status': v['status'] or None,
                'vehicle_type': 'Van' if has(v['desc'], VANS) else 'SUV' if has(v['desc'], SUVS) else None,
                'fuel_type': 'Diesel' if has(v['desc'], DIESEL_ONLY) else None,
                'current_odometer': top or None, 'remarks': '; '.join(remarks)})
            if v['par']:
                driver = v['driver'] and self.match_driver(v['driver'], drivers)
                if v['driver'] and not driver:
                    driver = v['driver']
                    self.note('RO3', v['row'], f'Driver "{v["driver"]}" matches no single name on the driver list; kept as written.')
                self.rows['Assignments'].append({'plate_number': v['plate'], 'office': v['office'],
                                                 'accountable_person': v['par'], 'driver_name': driver or None})
            if v['gsis']:
                self.rows['Documents'].append({'plate_number': v['plate'], 'document_type': 'GSIS Insurance', 'expiry_date': v['gsis']})
            if v['lto']:
                self.rows['Documents'].append({'plate_number': v['plate'], 'document_type': 'LTO Registration', 'issue_date': v['lto'],
                                               'remarks': f'Renewal month: {v["renew"].title()}' if v['renew'] else ''})
        self.rows['Offices'] = [{'name_in_old_sheet': a, 'office_code': OFFICE_ALIASES[a]} for a in sorted(self.aliases)]
        self.note('', '', 'Inferred, please check: vehicle type (HiAce/L300/Travis = Van; Innova/Crosswind/Adventure/Revo/'
                  'Sportivo = SUV), Diesel for models sold only as diesel, maintenance categories from the description, '
                  'the odometer from "PMS (km)" descriptions, and the office codes on the Offices sheet.')
        self.note('', '', 'To fill in before importing (not in the old workbook): fuel unit price, assignment start date, '
                  'driver license type, LTO registration expiry date.')
        return self


def convert(source, target):
    """Write the standard import workbook filled from the old workbook; returns {sheet: row count} and the notes."""
    conv = Converter(source).run()
    write_template(target)
    wb = load_workbook(target)
    for sheet, items in conv.rows.items():
        keys = [c['key'] for c in SHEETS[sheet][1]]
        for item in items:
            wb[sheet].append([item.get(k) for k in keys])
    notes = wb.create_sheet(NOTES_SHEET)
    notes.append(['Old sheet', 'Row', 'Note'])
    for n in conv.notes:
        notes.append(list(n))
    notes.column_dimensions['C'].width = 120
    wb.save(target)
    return {sheet: len(items) for sheet, items in conv.rows.items()}, conv.notes
