"""Idempotent: creates role groups with model permissions and maintenance categories. Safe to re-run."""
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction

from maintenance.models import MaintenanceCategory

VIMS_APPS = ['accounts', 'fleet', 'operations', 'maintenance', 'notifications', 'audit']

# role -> list of (app_label, model or '*', actions)
ROLES = {
    'System Administrator': [(app, '*', '*') for app in VIMS_APPS],  # every permission, incl. custom ones
    'Fleet Administrator': [
        ('accounts', 'office', 'view'),
        ('fleet', '*', 'add change view'),
        ('fleet', 'vehicle', 'manage'),  # manage_vehicle_photo
        ('operations', '*', 'add change view'),
        ('maintenance', '*', 'add change view'),
        ('notifications', 'notification', 'view change'),
    ],
    'Field Office User': [
        ('accounts', 'office', 'view'),
        ('fleet', '*', 'view'),
        ('operations', 'trip', 'add change view'),
        ('operations', 'fuelrecord', 'add change view'),
        ('operations', 'tolltransaction', 'add change view'),
        ('operations', 'rfidaccount', 'view'),
        ('maintenance', 'maintenancerecord', 'add change view'),
        ('maintenance', 'maintenancecategory', 'view'),
        ('maintenance', 'maintenanceschedule', 'view'),
        ('notifications', 'notification', 'view change'),
    ],
    'Viewer': [
        ('accounts', 'office', 'view'),
        ('fleet', '*', 'view'),
        ('operations', '*', 'view'),
        ('maintenance', '*', 'view'),
        ('notifications', 'notification', 'view'),
    ],
}

# Roles that see every office's records; everyone else is limited to User.offices.
ALL_OFFICE_ROLES = {'System Administrator', 'Fleet Administrator', 'Viewer'}

CATEGORIES = ['Preventive Maintenance', 'Engine', 'Tires', 'Brakes', 'Air Conditioning',
              'Battery', 'Body', 'Electrical', 'Other']


def permissions_for(rules):
    perms = Permission.objects.none()
    for app, model, actions in rules:
        qs = Permission.objects.filter(content_type__app_label=app)
        if actions != '*':
            qs = qs.filter(codename__regex=rf'^({"|".join(actions.split())})_')
        if model != '*':
            qs = qs.filter(content_type__model=model)
        perms |= qs
    return perms.exclude(codename='view_all_offices')  # matches 'view_' but is granted explicitly


class Command(BaseCommand):
    help = 'Create/refresh role groups and maintenance categories.'

    @transaction.atomic
    def handle(self, *args, **opts):
        for role, rules in ROLES.items():
            group, _ = Group.objects.get_or_create(name=role)
            perms = permissions_for(rules)
            if role in ALL_OFFICE_ROLES:
                perms |= Permission.objects.filter(codename='view_all_offices')
            group.permissions.set(perms)
            self.stdout.write(f'{role}: {group.permissions.count()} permissions')
        for name in CATEGORIES:
            MaintenanceCategory.objects.get_or_create(name=name)
        self.stdout.write(self.style.SUCCESS(f'{len(CATEGORIES)} maintenance categories ensured.'))
