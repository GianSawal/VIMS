from django.contrib.auth.models import AbstractUser
from django.db import models


class Office(models.Model):
    class Type(models.TextChoices):
        REGIONAL = 'REGIONAL', 'Regional Office'
        PROVINCIAL = 'PROVINCIAL', 'Provincial Office'
        FIELD = 'FIELD', 'Field Office'
        SATELLITE = 'SATELLITE', 'Satellite Office'

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=150, unique=True)
    office_type = models.CharField(max_length=20, choices=Type.choices)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='children')
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['code']
        permissions = [('view_all_offices', 'Can access records of all offices')]

    def __str__(self):
        return f'{self.code} - {self.name}'


class User(AbstractUser):
    # Role = Django Group (System Administrator / Fleet Administrator / Field Office User / Viewer).
    offices = models.ManyToManyField(Office, blank=True, related_name='users',
                                     help_text='Offices whose records this user may access.')
    must_change_password = models.BooleanField(default=False)
