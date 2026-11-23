"""Logins for drivers: role Driver (their own trips, record the return; vehicle requests), one per driver record.

The temporary password is returned once, to show the administrator; it is never stored or logged in plain text,
and the driver must change it at first login.
"""
import re

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.utils.crypto import get_random_string
from rest_framework.exceptions import ValidationError

from operations.trips import NOT_INITIALS

from .models import Driver

ROLE = 'Driver'
PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'  # no 0/o, 1/l/i: read aloud or copied from paper


def username_for(driver):
    """Employee number ('2021-0042' -> '2021-0042'), else first initial + surname ('GILBERT G. GOMEZ' -> 'ggomez').
    A taken name gets a number: ggomez2."""
    base = re.sub(r'[^a-z0-9._-]', '', (driver.employee_number or '').lower())
    if not base:
        words = [w for w in re.findall(r'[A-Za-zÑñ]+', driver.full_name) if w.upper() not in NOT_INITIALS]
        base = (words[0][0] + words[-1] if len(words) > 1 else ''.join(words)).lower().replace('ñ', 'n') or 'driver'
    taken = set(get_user_model().objects.filter(username__istartswith=base).values_list('username', flat=True))
    taken = {t.lower() for t in taken}
    name, n = base, 1
    while name in taken:
        n += 1
        name = f'{base}{n}'
    return name


def create_account(driver):
    """Returns (user, temporary_password). Refuses inactive drivers and drivers who already have a login."""
    try:
        role = Group.objects.get(name=ROLE)
    except Group.DoesNotExist:
        raise ValidationError('The Driver role does not exist yet. Run manage.py seed_reference.')
    with transaction.atomic():
        d = Driver.objects.select_for_update().select_related('office').get(pk=driver.pk)
        if d.user_id:
            raise ValidationError(f'{d.full_name} already has an account ({d.user.username}).')
        if not d.is_active:
            raise ValidationError(f'{d.full_name} is inactive. Activate the driver first.')
        password = get_random_string(10, PASSWORD_CHARS)
        *first, last = d.full_name.split() or ['']
        user = get_user_model().objects.create_user(
            username_for(d), password=password, first_name=' '.join(first)[:150], last_name=last[:150],
            must_change_password=True)
        user.groups.add(role)
        user.offices.add(d.office)
        d.user = user
        d.save(update_fields=['user', 'updated_at'])
    return user, password
