"""
python manage.py seed_demo [--scale N]        # demo / QA data on a throwaway SQLite database

Realistic records for QA, UAT rehearsals and performance checks: offices, one login per role, vehicles with
assignments, documents in every expiry band, fuel, maintenance (one job open), schedules, trips in every state, RFID
accounts with tolls, a TV screen and notifications. Deterministic (same data every run).

Refuses any database but SQLite, so it can never write to the shared or production MySQL. The QA logins get one
random password, written to qa-accounts.txt next to manage.py (git-ignored) and never printed.
"""
import io
import random
import secrets
from datetime import datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone
from PIL import Image

from accounts.models import Office, User
from fleet.models import Attachment, Driver, Vehicle, VehicleAssignment, VehicleDocument
from maintenance.models import MaintenanceCategory, MaintenanceRecord, MaintenanceSchedule
from notifications.services import generate
from operations.models import DisplayScreen, FuelRecord, RFIDAccount, TollTransaction, Trip

OFFICES = [('R03', 'DOLE Regional Office III', 'REGIONAL', None), ('TAR', 'Tarlac Field Office', 'FIELD', 'R03'),
           ('PAM', 'Pampanga Field Office', 'FIELD', 'R03'), ('BUL', 'Bulacan Field Office', 'FIELD', 'R03'),
           ('NEC', 'Nueva Ecija Field Office', 'FIELD', 'R03')]
# username -> (role, offices); a Field Office User sees TAR only.
ACCOUNTS = {'qa_sysadmin': ('System Administrator', []), 'qa_fleetadmin': ('Fleet Administrator', []),
            'qa_field': ('Field Office User', ['TAR']), 'qa_viewer': ('Viewer', []), 'qa_norole': (None, ['TAR'])}
MODELS = [('Toyota', 'Hiace', 'Commuter 3.0', 'VAN', 'DIESEL'), ('Toyota', 'Innova', 'E 2.8 AT', 'SUV', 'DIESEL'),
          ('Mitsubishi', 'L300', 'FB', 'VAN', 'DIESEL'), ('Toyota', 'Vios', '1.3 XLE', 'SEDAN', 'GASOLINE'),
          ('Isuzu', 'Traviz', 'Utility Van', 'VAN', 'DIESEL'), ('Nissan', 'Navara', 'EL 4x2', 'PICKUP', 'DIESEL'),
          ('Mitsubishi', 'Montero Sport', 'GLX', 'SUV', 'DIESEL'), ('Toyota', 'Hilux', 'J 4x2', 'PICKUP', 'DIESEL')]
COLORS = ['White', 'Silver', 'Gray', 'Blue', 'Red', 'Black']
FIRST = ['Juan', 'Pedro', 'Jose', 'Ramon', 'Carlos', 'Antonio', 'Manuel', 'Ricardo', 'Eduardo', 'Rodel', 'Arnel', 'Noel']
LAST = ['Dela Cruz', 'Santos', 'Reyes', 'Garcia', 'Mendoza', 'Bautista', 'Villanueva', 'Ramos', 'Aquino', 'Castillo',
        'Navarro', 'Torres', 'Flores', 'Lopez']
PLACES = ['Regional Office, San Fernando', 'Tarlac City', 'Malolos, Bulacan', 'Cabanatuan City', 'Angeles City',
          'Clark Freeport Zone', 'Subic Bay Freeport', 'Balanga, Bataan', 'Iba, Zambales', 'Baler, Aurora']
PURPOSES = ['Labor inspection', 'TUPAD payout monitoring', 'Job fair', 'DOLE caravan', 'Livelihood turnover',
            'Meeting with LGU', 'Mediation conference', 'Delivery of training materials']
SHOPS = ['Toyota San Fernando', 'Mitsubishi Tarlac', 'Petron Service Center', 'Goodyear Autocare', 'Motolite Express']
JOBS = [('Change oil and filters (PMS)', ['Preventive Maintenance'], 3500), ('Replace front brake pads', ['Brakes'], 4200),
        ('Replace two tires', ['Tires'], 11000), ('Aircon cleaning and freon recharge', ['Air Conditioning'], 5500),
        ('Replace battery', ['Battery'], 6800), ('Repaint rear bumper', ['Body'], 9000)]
PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'


class Command(BaseCommand):
    help = 'Fill a throwaway SQLite database with realistic demo/QA data (refuses MySQL).'

    def add_arguments(self, parser):
        parser.add_argument('--scale', type=int, default=6, help='Vehicles per office (default 6; 100+ for load tests)')
        parser.add_argument('--months', type=int, default=6, help='Months of fuel/trip history (default 6)')
        parser.add_argument('--accounts-file', default=str(Path(settings.BASE_DIR) / 'qa-accounts.txt'),
                            help='Where to write the QA logins (default qa-accounts.txt next to manage.py)')

    def handle(self, *args, scale, months, accounts_file, **opts):
        if connection.vendor != 'sqlite':
            raise CommandError('seed_demo only runs on a throwaway SQLite database '
                               '(DATABASE_URL=sqlite:///qa.sqlite3), never on MySQL.')
        if Vehicle.objects.exists():
            raise CommandError('The database already has vehicles. Use a fresh SQLite file.')
        call_command('seed_reference', stdout=io.StringIO())
        self.rng = random.Random(16)
        self.today = timezone.localdate()
        with transaction.atomic():
            offices = self.offices()
            password = self.accounts(offices)
            admin = User.objects.get(username='qa_fleetadmin')
            counts = self.fleet(offices, admin, scale, months)
            RFIDAccount.objects.create(provider='AUTOSWEEP', account_number='AS-0000-7777', remarks='Spare, unassigned',
                                       created_by=admin)
        created = generate()
        self.stdout.write(self.style.SUCCESS('Demo data: ' + ', '.join(f'{n} {k}' for k, n in counts.items())
                                             + f', {created} notifications.'))
        path = Path(accounts_file)
        path.write_text('QA logins for the throwaway demo database only (git-ignored). Password for all:\n'
                        f'{password}\n\n' + '\n'.join(f'{u}: {r or "no role"} {o or "all offices"}'
                                                       for u, (r, o) in ACCOUNTS.items()) + '\n')
        self.stdout.write(f'Logins: {", ".join(ACCOUNTS)}. Password in {path.name}.')

    def offices(self):
        out = {}
        for code, name, kind, parent in OFFICES:
            out[code] = Office.objects.create(code=code, name=name, office_type=kind, parent=out.get(parent))
        return out

    def accounts(self, offices):
        password = secrets.token_urlsafe(12)
        for username, (role, codes) in ACCOUNTS.items():
            first, last = username.split('_')[1].title(), 'QA'
            u = User.objects.create_user(username, password=password, first_name=first, last_name=last,
                                         email=f'{username}@example.test')
            if role:
                u.groups.add(Group.objects.get(name=role))
            u.offices.set([offices[c] for c in codes])
        return password

    def at(self, day, hour, minute=0):
        return timezone.make_aware(datetime.combine(day, time(hour, minute)))

    def photo(self, color):
        buf = io.BytesIO()
        Image.new('RGB', (480, 320), color).save(buf, 'PNG')
        return ContentFile(buf.getvalue(), name='car.png')

    def fleet(self, offices, admin, scale, months):
        rng, today = self.rng, self.today
        cats = {c.name: c for c in MaintenanceCategory.objects.all()}
        plates = set()
        counts = dict.fromkeys(['vehicles', 'drivers', 'documents', 'fuel records', 'maintenance jobs', 'trips',
                                'toll rows'], 0)
        ticket = Trip.objects.count()  # continue numbering when more offices are added (performance test)
        for code, office in offices.items():
            drivers = []
            for i in range(max(2, scale // 2)):
                days = rng.choice([-20, 5, 25, 50, 400, 700, 900])  # some expired / expiring licenses
                drivers.append(Driver.objects.create(
                    full_name=f'{rng.choice(FIRST)} {rng.choice("ABCDEFGMR")}. {rng.choice(LAST)}', office=office,
                    employee_number=f'{code}-{i + 1:03d}', contact_number=f'0917{rng.randint(1000000, 9999999)}',
                    license_number=f'{code[0]}{rng.randint(10, 99)}-{rng.randint(10, 99)}-{rng.randint(100000, 999999)}',
                    license_type='PROFESSIONAL', license_restrictions='B, B1, B2',
                    license_issue_date=today - timedelta(days=1825 - days), license_expiry_date=today + timedelta(days=days),
                    created_by=admin))
            counts['drivers'] += len(drivers)
            for i in range(scale):
                make, model, variant, kind, fuel = rng.choice(MODELS)
                while (plate := f'{rng.choice("ABNS")}{rng.choice("ABCDEFG")}{rng.choice("AKLT")} {rng.randint(1000, 9999)}') in plates:
                    pass
                plates.add(plate)
                odo = rng.randint(15000, 120000)
                v = Vehicle.objects.create(
                    plate_number=plate, property_number=f'PN-{code}-{i + 1:03d}', make=make, model=model, variant=variant,
                    year_model=rng.randint(2012, 2024), vehicle_type=kind, color=rng.choice(COLORS), fuel_type=fuel,
                    acquisition_date=today - timedelta(days=rng.randint(400, 4000)),
                    acquisition_cost=Decimal(rng.randint(900, 2500) * 1000), current_odometer=odo, office=office,
                    created_by=admin)
                if i % 3 == 0:
                    v.photo = self.photo(rng.choice(['#3b6ea8', '#a83b3b', '#6b6b6b', '#e8e8e8']))
                driver = drivers[i % len(drivers)]
                VehicleAssignment.objects.create(vehicle=v, office=office, accountable_person=f'{rng.choice(FIRST)} {rng.choice(LAST)}',
                                                 driver=driver, driver_name=driver.full_name,
                                                 start_date=today - timedelta(days=rng.randint(30, 600)), created_by=admin)
                counts['documents'] += self.documents(v, i, admin)
                odo, n_fuel = self.fuel(v, driver, odo, months, admin)
                counts['fuel records'] += n_fuel
                odo, n_jobs, open_job = self.maintenance(v, cats, odo, months, i, admin)
                counts['maintenance jobs'] += n_jobs
                odo, n_trips, ticket, out_now = self.trips(v, drivers, odo, months, ticket, i, admin)
                counts['trips'] += n_trips
                counts['toll rows'] += self.tolls(v, i, admin)
                v.current_odometer = odo
                v.status = (Vehicle.Status.UNDER_MAINTENANCE if open_job else Vehicle.Status.IN_USE if out_now
                            else Vehicle.Status.FOR_REPAIR if i % 11 == 7 else Vehicle.Status.SERVICEABLE)
                v.save()
                counts['vehicles'] += 1
            DisplayScreen.objects.create(name=f'Lobby TV, {office.name}', office=office)
        return counts

    def documents(self, v, i, admin):
        today, n = self.today, 0
        bands = [-10, 5, 12, 25, 50, 200]  # expired, 7, 15, 30, 60 days, valid
        for kind, years in [('LTO_REGISTRATION', 1), ('GSIS_INSURANCE', 1), ('OR', 1), ('CR', None)]:
            expiry = None if years is None else today + timedelta(days=bands[(i + n) % len(bands)])
            if expiry:  # last year's copy, already renewed
                VehicleDocument.objects.create(vehicle=v, document_type=kind, reference_number=f'{kind[:3]}-{v.pk}-{expiry.year - 1}',
                                               issue_date=expiry - timedelta(days=730), expiry_date=expiry - timedelta(days=365),
                                               status='SUPERSEDED', created_by=admin)
                n += 1
            doc = VehicleDocument.objects.create(vehicle=v, document_type=kind, reference_number=f'{kind[:3]}-{v.pk}-{today.year}',
                                                 issue_date=(expiry or today) - timedelta(days=365), expiry_date=expiry, created_by=admin)
            if n % 3 == 0:
                doc.file.save('scan.pdf', ContentFile(PDF), save=True)
            n += 1
        return n

    def fuel(self, v, driver, odo, months, admin):
        rng, n = self.rng, 0
        day = self.today - timedelta(days=30 * months)
        start = odo - rng.randint(4000, 9000)
        odo = max(start, 1000)
        while day < self.today:
            odo += rng.randint(250, 600)
            liters = Decimal(rng.randint(250, 550)) / 10
            price = Decimal(rng.randint(5600, 6900)) / 100
            FuelRecord.objects.create(date=day, vehicle=v, driver=driver, po_number=f'PO-{day:%y%m}-{v.pk:03d}{n}',
                                      supplier=rng.choice(['Petron', 'Shell', 'Caltex']), fuel_type=v.fuel_type,
                                      liters=liters, unit_price=price, total_amount=(liters * price).quantize(Decimal('0.01')),
                                      odometer=odo, is_full_tank=rng.random() < 0.7, receipt_number=f'OR{rng.randint(10000, 99999)}',
                                      created_by=admin)
            n += 1
            day += timedelta(days=rng.randint(8, 20))
        return odo, n

    def maintenance(self, v, cats, odo, months, i, admin):
        rng, n = self.rng, 0
        for k in range(rng.randint(1, 3)):
            title, names, cost = rng.choice(JOBS)
            day = self.today - timedelta(days=rng.randint(10, 30 * months))
            r = MaintenanceRecord.objects.create(
                vehicle=v, date=day, odometer=odo - rng.randint(500, 3000), reference_number=f'PR-{day:%Y}-{v.pk:03d}{k}',
                description=title, service_provider=rng.choice(SHOPS), labor_cost=Decimal(cost) * Decimal('0.3'),
                parts_cost=Decimal(cost) * Decimal('0.7'), status='COMPLETED', started_on=day, completed_on=day,
                created_by=admin)
            r.categories.set([cats[c] for c in names])
            n += 1
        open_job = i % 7 == 3
        if open_job:
            r = MaintenanceRecord.objects.create(vehicle=v, date=self.today - timedelta(days=2), odometer=odo,
                                                 description='Engine overheating, for diagnosis', service_provider=SHOPS[0],
                                                 status='IN_PROGRESS', started_on=self.today - timedelta(days=1), created_by=admin)
            r.categories.set([cats['Engine']])
            n += 1
        last = self.today - timedelta(days=rng.choice([20, 150, 175, 200]))  # some due soon / overdue
        MaintenanceSchedule.objects.create(vehicle=v, category=cats['Preventive Maintenance'], interval_days=180,
                                           interval_km=5000, last_service_date=last,
                                           last_service_odometer=odo - rng.choice([800, 4700, 5300]))
        return odo, n, open_job

    def trips(self, v, drivers, odo, months, ticket, i, admin):
        rng, n = self.rng, 0
        day = self.today - timedelta(days=30 * months)
        while day < self.today - timedelta(days=1):
            ticket += 1
            km = rng.randint(30, 260)
            depart = self.at(day, rng.randint(6, 10))
            Trip.objects.create(ticket_number=f'TT-{day:%Y}-{ticket:05d}', vehicle=v, driver=rng.choice(drivers),
                                origin=PLACES[0], destination=rng.choice(PLACES[1:]), purpose=rng.choice(PURPOSES),
                                passengers='Labor inspectors (3)', departed_at=depart, returned_at=depart + timedelta(hours=rng.randint(4, 10)),
                                odometer_start=odo, odometer_end=odo + km, status='COMPLETED', created_by=admin)
            odo += km
            n += 1
            day += timedelta(days=rng.randint(4, 14))
        out_now = i % 4 == 1
        if out_now:  # on the road today
            ticket += 1
            Trip.objects.create(ticket_number=f'TT-{self.today:%Y}-{ticket:05d}', vehicle=v, driver=drivers[0],
                                origin=PLACES[0], destination=rng.choice(PLACES[1:]), purpose=rng.choice(PURPOSES),
                                departed_at=timezone.now() - timedelta(hours=2), odometer_start=odo, status='DISPATCHED',
                                created_by=admin)
            n += 1
        if i % 4 == 2:  # booked for the coming days
            ticket += 1
            when = self.at(self.today + timedelta(days=rng.randint(0, 6)), 8)
            Trip.objects.create(ticket_number=f'TT-{self.today:%Y}-{ticket:05d}', vehicle=v, driver=drivers[-1],
                                origin=PLACES[0], destination=rng.choice(PLACES[1:]), purpose=rng.choice(PURPOSES),
                                scheduled_departure=when, scheduled_return=when + timedelta(hours=8), status='SCHEDULED',
                                created_by=admin)
            n += 1
        if i % 9 == 5:
            ticket += 1
            when = self.at(self.today - timedelta(days=3), 8)
            Trip.objects.create(ticket_number=f'TT-{self.today:%Y}-{ticket:05d}', vehicle=v, driver=drivers[0],
                                origin=PLACES[0], destination=PLACES[2], purpose='Cancelled: vehicle unavailable',
                                scheduled_departure=when, status='CANCELLED', remarks='Cancelled: driver on leave',
                                created_by=admin)
            n += 1
        if n:
            last = Trip.objects.filter(vehicle=v, status='COMPLETED').first()
            if last:
                Attachment.objects.create(content_type=ContentType.objects.get_for_model(Trip), object_id=last.pk,
                                          file=ContentFile(PDF, name='ticket.pdf'), original_name='Signed trip ticket.pdf',
                                          size=len(PDF), description='Scanned trip ticket')
        return odo, n, ticket, out_now

    def tolls(self, v, i, admin):
        if v.vehicle_type not in ('VAN', 'SUV'):
            return 0
        rng = self.rng
        acc = RFIDAccount.objects.create(provider='EASYTRIP' if i % 2 else 'AUTOSWEEP',
                                         account_number=f'{rng.randint(10**9, 10**10 - 1)}', vehicle=v, created_by=admin)
        when, n = timezone.now() - timedelta(days=60), 0
        for k in range(rng.randint(4, 10)):
            if k % 4 == 0:
                TollTransaction.objects.create(account=acc, vehicle=v, transacted_at=when, description='Reload',
                                               credit=Decimal(1000), reference_number=f'RL{rng.randint(1000, 9999)}', created_by=admin)
            else:
                TollTransaction.objects.create(account=acc, vehicle=v, transacted_at=when,
                                               description=rng.choice(['NLEX Balintawak', 'SCTEX Tarlac', 'NLEX San Fernando', 'TPLEX Rosario']),
                                               debit=Decimal(rng.choice([85, 132, 254, 311])), created_by=admin)
            n += 1
            when += timedelta(days=rng.randint(2, 8))
        return n
