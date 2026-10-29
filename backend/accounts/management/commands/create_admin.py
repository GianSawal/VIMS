"""Create the first System Administrator with a one-time password (changed at first login). Run after seed_reference."""
import secrets

from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import User


class Command(BaseCommand):
    help = 'Create a System Administrator account with a random temporary password (shown once).'

    def add_arguments(self, parser):
        parser.add_argument('username')
        parser.add_argument('--email', default='')
        parser.add_argument('--first-name', default='')
        parser.add_argument('--last-name', default='')

    @transaction.atomic
    def handle(self, *args, **opts):
        username = opts['username'].strip()
        if User.objects.filter(username__iexact=username).exists():
            raise CommandError(f'User "{username}" already exists.')
        try:
            role = Group.objects.get(name='System Administrator')
        except Group.DoesNotExist:
            raise CommandError('Role groups are missing; run "python manage.py seed_reference" first.')
        password = secrets.token_urlsafe(12)
        # is_staff opens the Django admin (TV display screens); permissions come from the role, not is_superuser.
        user = User.objects.create_user(username, opts['email'], password, first_name=opts['first_name'],
                                        last_name=opts['last_name'], is_staff=True, must_change_password=True)
        user.groups.set([role])
        self.stdout.write(self.style.SUCCESS(f'Created System Administrator "{username}".'))
        self.stdout.write(f'Temporary password (shown once, must be changed at first login): {password}')
