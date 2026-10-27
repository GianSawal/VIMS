from django.core.management.base import BaseCommand

from notifications.services import generate


class Command(BaseCommand):
    help = 'Generate expiry/due notifications (idempotent). Run on a schedule, e.g. daily.'

    def handle(self, *args, **options):
        created = generate()
        self.stdout.write(self.style.SUCCESS(f'Created {created} new notification(s).'))
