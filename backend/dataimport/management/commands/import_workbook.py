"""
python manage.py import_workbook --template vrs-import-template.xlsx      # write the blank import workbook
python manage.py import_workbook --prepare "../DATA/VEHICLE RECORD.xlsx" "../DATA/VEHICLE RECORD (to fill).xlsx"
                                          # copy of RO3's old workbook with the columns the import needs, to fill in
python manage.py import_workbook --convert "../DATA/VEHICLE RECORD (to fill).xlsx" filled.xlsx   # -> import workbook
python manage.py import_workbook filled.xlsx --user admin                 # dry run: nothing saved, report written
python manage.py import_workbook filled.xlsx --user admin --commit        # import for real

Every run copies the source workbook to import_runs/ (backup) and writes <name>-report.xlsx there with the
summary and every flagged row. See docs/MIGRATION.md for the procedure.
"""
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from accounts.models import User
from audit.models import AuditLog
from dataimport import legacy
from dataimport.importer import Importer, read_workbook, write_report, write_template

RUNS_DIR = Path(settings.BASE_DIR) / 'import_runs'


class Command(BaseCommand):
    help = 'Import legacy vehicle records from the standard import workbook (dry run unless --commit).'

    def add_arguments(self, parser):
        parser.add_argument('workbook', nargs='?', help='Filled import workbook (.xlsx)')
        parser.add_argument('--template', metavar='PATH', help='Write the blank import workbook to PATH and stop')
        parser.add_argument('--prepare', nargs=2, metavar=('OLD', 'OUT'),
                            help="Copy RO3's old workbook OLD to OUT with the extra columns the import needs, and stop")
        parser.add_argument('--convert', nargs=2, metavar=('OLD', 'OUT'),
                            help="Convert RO3's old per-vehicle workbook OLD into a filled import workbook OUT and stop")
        parser.add_argument('--commit', action='store_true', help='Save the records (default: dry run, everything rolled back)')
        parser.add_argument('--user', help='Username recorded as creator of the imported records and in the audit log')
        parser.add_argument('--out', default=str(RUNS_DIR), help='Folder for the backup copy and the report')

    def handle(self, *args, workbook=None, template=None, prepare=None, convert=None, commit=False, user=None, out=None, **opts):
        if prepare:
            if Path(prepare[0]).resolve() == Path(prepare[1]).resolve():
                raise CommandError('Write the prepared copy to a different file; the original is kept as it is.')
            notes = legacy.prepare(*prepare)
            self.stdout.write(self.style.SUCCESS(f'Prepared copy written to {prepare[1]} (new columns highlighted).'))
            for n in notes:
                self.stdout.write(f'  check: {n}')
            return
        if convert:
            counts, notes = legacy.convert(*convert)
            self.stdout.write(self.style.SUCCESS(f'Converted {Path(convert[0]).name} -> {convert[1]}'))
            for name, n in counts.items():
                self.stdout.write(f'{name:<12} {n:>6} row(s)')
            self.stdout.write(f'{len(notes)} note(s) on the "Conversion notes" sheet. Review the workbook, then dry-run it.')
            return
        if template:
            write_template(template)
            self.stdout.write(self.style.SUCCESS(f'Template written to {template}'))
            return
        if not workbook:
            raise CommandError('Give the workbook to import, or --template PATH for a blank one.')
        source = Path(workbook)
        if not source.is_file():
            raise CommandError(f'File not found: {source}')
        actor = None
        if user:
            actor = User.objects.filter(username=user).first()
            if not actor:
                raise CommandError(f'No user "{user}".')
        elif commit:
            raise CommandError('--commit needs --user so imported records and the audit entry show who ran it.')

        out_dir = Path(out)
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = timezone.localtime().strftime('%Y%m%d-%H%M%S')
        mode = 'commit' if commit else 'dryrun'
        backup = out_dir / f'{stamp}-{source.stem}-source{source.suffix}'
        shutil.copy2(source, backup)

        sheets, layout_issues = read_workbook(source)
        importer = Importer(actor)
        importer.issues.extend(layout_issues)
        summary = importer.run(sheets, commit=commit)
        report = out_dir / f'{stamp}-{source.stem}-{mode}-report.xlsx'
        write_report(report, source.name, summary, importer.issues, commit)

        if commit:
            AuditLog.objects.create(user=actor, username=actor.username, action='import', entity_type='import',
                                    description=f'Imported workbook {source.name}', changes={'summary': summary})

        self.stdout.write(f'{"COMMITTED" if commit else "DRY RUN - nothing was saved"}: {source.name}')
        self.stdout.write(f'{"Sheet":<12} {"created":>8} {"updated":>8} {"skipped":>8} {"failed":>7} {"warnings":>9}')
        for name, c in summary.items():
            self.stdout.write(f'{name:<12} {c["created"]:>8} {c["updated"]:>8} {c["skipped"]:>8} {c["failed"]:>7} {c["warnings"]:>9}')
        errors = sum(1 for i in importer.issues if i.level == 'error')
        warnings = len(importer.issues) - errors
        self.stdout.write(f'{errors} error(s), {warnings} warning(s). Review: {report}')
        self.stdout.write(f'Source backed up to {backup}')
