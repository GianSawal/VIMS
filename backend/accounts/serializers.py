from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import Office, User
from .permissions import VIEW_ALL_OFFICES


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
        return user.has_perm(VIEW_ALL_OFFICES)


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SlugRelatedField(slug_field='name', queryset=Group.objects.all(), write_only=True)
    role_name = serializers.SerializerMethodField()
    office_details = OfficeBriefSerializer(source='offices', many=True, read_only=True)
    password = serializers.CharField(write_only=True, required=False, style={'input_type': 'password'},
                                     help_text='Initial password (create only). User must change it at first login.')

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'is_active', 'role', 'role_name',
                  'offices', 'office_details', 'password', 'must_change_password', 'last_login', 'date_joined']
        read_only_fields = ['must_change_password', 'last_login', 'date_joined']

    def get_role_name(self, user):
        return role_of(user)

    def validate(self, attrs):
        if self.instance is None:
            if not attrs.get('password'):
                raise serializers.ValidationError({'password': 'An initial password is required.'})
            try:
                validate_password(attrs['password'], User(username=attrs.get('username')))
            except DjangoValidationError as e:
                raise serializers.ValidationError({'password': e.messages})
        else:
            attrs.pop('password', None)  # changed only via reset-password
        return attrs

    def create(self, data):
        role, offices, password = data.pop('role'), data.pop('offices', []), data.pop('password')
        user = User(**data, must_change_password=True)
        user.set_password(password)
        user.save()
        user.groups.set([role])
        user.offices.set(offices)
        return user

    def update(self, user, data):
        role, offices = data.pop('role', None), data.pop('offices', None)
        for k, v in data.items():
            setattr(user, k, v)
        user.save()
        if role is not None:
            user.groups.set([role])
        if offices is not None:
            user.offices.set(offices)
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
