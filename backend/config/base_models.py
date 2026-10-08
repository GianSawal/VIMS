import os
import uuid

from django.conf import settings
from django.db import models


class Tracked(models.Model):
    """created/updated stamps shared by operational records."""
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, editable=False,
        on_delete=models.SET_NULL, related_name='+',
    )

    class Meta:
        abstract = True


def safe_upload_to(instance, filename):
    """<app>/<model>/<random>.<ext>: no user-controlled paths, no collisions."""
    ext = os.path.splitext(filename)[1].lower()[:10]
    return f'{instance._meta.app_label}/{instance._meta.model_name}/{uuid.uuid4().hex}{ext}'


def non_negative(*fields):
    """CheckConstraints that keep money/quantity/odometer fields >= 0 at the DB level."""
    return [
        models.CheckConstraint(condition=models.Q(**{f'{f}__gte': 0}), name=f'%(app_label)s_%(class)s_{f}_gte_0')
        for f in fields
    ]


def ordered(start, end):
    """CheckConstraint: `end` is empty or not before `start`."""
    return models.CheckConstraint(
        condition=models.Q(**{f'{end}__isnull': True}) | models.Q(**{f'{end}__gte': models.F(start)}),
        name=f'%(app_label)s_%(class)s_{end}_after_{start}',
    )
