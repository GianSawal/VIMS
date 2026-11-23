from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from fleet.models import Driver

from .models import Office, User
from .permissions import sees_all_offices


class OfficeSerializer(serializers.ModelSerializer):
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)

    class Meta:
        model = Office
        fields = ['id', 'code', 'name', 'office_type', 'parent', 'parent_name', 'is_active']

    def validate_code(self, value):
        return value.strip().upper()

    def validate_parent(self, parent):
        if parent and self.instance and parent.pk == self.instance.pk:
            raise serializers.ValidationError('An office cannot be its own parent.')
        return parent


class OfficeBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Office
        fields = ['id', 'code', 'name']


def role_of(user):
    group = user.groups.first()
    return group.name if group else None


class MeSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    offices = OfficeBriefSerializer(many=True, read_only=True)
    permissions = serializers.SerializerMethodField()
    view_all_offices = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'is_superuser', 'must_change_password',
                  'last_login', 'role', 'offices', 'permissions', 'view_all_offices']

    def get_role(self, user):
        return 'System Administrator' if user.is_superuser else role_of(user)

    def get_permissions(self, user):
        return sorted(user.get_all_permissions())

    def get_view_all_offices(self, user):
        return sees_all_offices(user)


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SlugRelatedField(slug_field='name', queryset=Group.objects.all(), write_only=True)
    role_name = serializers.SerializerMethodField()
    office_details = OfficeBriefSerializer(source='offices', many=True, read_only=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, style={'input_type': 'password'},
                                     help_text='Initial password on create; on edit, a new temporary password (blank keeps the current one). '
                                               'The user must change it at next login.')
    # Driver accounts: the driver record this login belongs to (its trips are what the driver sees).
    driver = serializers.PrimaryKeyRelatedField(queryset=Driver.objects.select_related('user', 'office'), required=False,
                                                allow_null=True, write_only=True)
    driver_id = serializers.IntegerField(source='driver.id', read_only=True, default=None)
    driver_name = serializers.CharField(source='driver.full_name', read_only=True, default=None)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'is_active', 'role', 'role_name',
                  'offices', 'office_details', 'password', 'must_change_password', 'last_login', 'date_joined',
                  'driver', 'driver_id', 'driver_name']
        read_only_fields = ['must_change_password', 'last_login', 'date_joined']

    def get_role_name(self, user):
        return role_of(user)

    def validate_username(self, value):
        # MySQL's collation treats GGomez and ggomez as the same: say so here instead of a database error.
        value = value.strip()
        if User.objects.exclude(pk=self.instance.pk if self.instance else None).filter(username__iexact=value).exists():
            raise serializers.ValidationError('This username is already taken.')
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get('password'):
            raise serializers.ValidationError({'password': 'An initial password is required.'})
        if not attrs.get('password'):
            attrs.pop('password', None)  # editing: blank keeps the current password
        else:  # initial password, or a new temporary one set while editing (same as reset-password)
            try:
                validate_password(attrs['password'], self.instance or User(username=attrs.get('username')))
            except DjangoValidationError as e:
                raise serializers.ValidationError({'password': e.messages})
        # A requester asks for vehicles for their own office, so they need one.
        role = attrs['role'].name if 'role' in attrs else self.instance and role_of(self.instance)
        offices = attrs['offices'] if 'offices' in attrs else self.instance and list(self.instance.offices.all())
        if role == 'Requester' and not offices:
            raise serializers.ValidationError({'offices': 'Select the office this requester belongs to.'})
        current = getattr(self.instance, 'driver', None) if self.instance else None
        driver = attrs.get('driver', current)
        if role == 'Driver':
            if driver is None:
                raise serializers.ValidationError({'driver': 'Select the driver this login belongs to.'})
            if driver.user_id and driver.user_id != (self.instance and self.instance.pk):
                raise serializers.ValidationError({'driver': f'{driver.full_name} already has a login ({driver.user.username}).'})
            if not driver.is_active and driver != current:
                raise serializers.ValidationError({'driver': f'{driver.full_name} is inactive.'})
            if not offices:
                attrs['offices'] = [driver.office]  # the driver's office, for their vehicle requests
        elif attrs.get('driver'):
            raise serializers.ValidationError({'driver': 'Only Driver accounts are linked to a driver.'})
        return attrs

    @staticmethod
    def _link(user, driver):
        """Point `driver` at this login, unlinking any other driver record it had."""
        Driver.objects.filter(user=user).exclude(pk=driver.pk).update(user=None)
        Driver.objects.filter(pk=driver.pk).update(user=user)
        user._state.fields_cache.pop('driver', None)  # so the response and audit snapshot read the new link

    @transaction.atomic
    def create(self, data):
        driver = data.pop('driver', None)
        role, offices, password = data.pop('role'), data.pop('offices', []), data.pop('password')
        user = User(**data, must_change_password=True)
        user.set_password(password)
        user.save()
        user.groups.set([role])
        user.offices.set(offices)
        if driver:
            self._link(user, driver)
        return user

    @transaction.atomic
    def update(self, user, data):
        driver = data.pop('driver', None)
        role, offices = data.pop('role', None), data.pop('offices', None)
        password = data.pop('password', None)
        if password:
            user.set_password(password)
            user.must_change_password = True
        for k, v in data.items():
            setattr(user, k, v)
        user.save()
        if role is not None:
            user.groups.set([role])
        if offices is not None:
            user.offices.set(offices)
        if driver:
            self._link(user, driver)
        return user


class PasswordSerializer(serializers.Serializer):
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        validate_password(value, self.context['user'])
        return value


class ChangePasswordSerializer(PasswordSerializer):
    current_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        if not self.context['user'].check_password(value):
            raise serializers.ValidationError('Current password is incorrect.')
        return value
