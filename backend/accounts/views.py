from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from audit.services import diff, log

from .models import Office, User
from .permissions import ModelPermissions, OfficeScopedMixin, PasswordChangeNotRequired
from .serializers import (ChangePasswordSerializer, MeSerializer, OfficeSerializer, PasswordSerializer,
                          UserSerializer)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


@method_decorator(ensure_csrf_cookie, name='get')
class CsrfView(APIView):
    """Sets the csrftoken cookie so the SPA can send X-CSRFToken."""
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'login'
    throttle_classes = [ScopedRateThrottle]

    def post(self, request):
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = authenticate(request, **s.validated_data)
        if user is None:
            log(request, 'login_failed', 'auth', f'Failed login for "{s.validated_data["username"]}"')
            return Response({'detail': 'Invalid username or password.'}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        log(request, 'login', user, f'{user.username} logged in', user=user)
        return Response(MeSerializer(user).data)


class LogoutView(APIView):
    allow_pending_password_change = True

    def post(self, request):
        log(request, 'logout', request.user, f'{request.user.username} logged out')
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    allow_pending_password_change = True

    def get(self, request):
        return Response(MeSerializer(request.user).data)


class ChangePasswordView(APIView):
    allow_pending_password_change = True

    def post(self, request):
        user = request.user
        s = ChangePasswordSerializer(data=request.data, context={'user': user})
        s.is_valid(raise_exception=True)
        user.set_password(s.validated_data['new_password'])
        user.must_change_password = False
        user.save()
        update_session_auth_hash(request, user)  # keep this session logged in
        log(request, 'password_change', user, f'{user.username} changed their password')
        return Response(MeSerializer(user).data)


class OfficeViewSet(OfficeScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                    mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """No delete: deactivate offices instead (they are referenced by historical records)."""
    queryset = Office.objects.select_related('parent')
    serializer_class = OfficeSerializer
    office_field = 'pk'
    search_fields = ['code', 'name']
    filterset_fields = ['office_type', 'is_active', 'parent']
    ordering_fields = ['code', 'name']

    def perform_create(self, serializer):
        office = serializer.save()
        log(self.request, 'create', office, f'Created office {office}')

    def perform_update(self, serializer):
        before = OfficeSerializer(serializer.instance).data
        office = serializer.save()
        log(self.request, 'update', office, f'Updated office {office}',
            diff(before, OfficeSerializer(office).data))


def user_snapshot(user):
    return {'is_active': user.is_active, 'role': user.groups.first() and user.groups.first().name,
            'offices': sorted(user.offices.values_list('code', flat=True)),
            'email': user.email, 'first_name': user.first_name, 'last_name': user.last_name}


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                  mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """User administration. No delete: deactivate (is_active=false) to keep history intact."""
    queryset = User.objects.prefetch_related('groups', 'offices').order_by('username')
    serializer_class = UserSerializer
    permission_classes = [ModelPermissions, PasswordChangeNotRequired]
    search_fields = ['username', 'first_name', 'last_name', 'email']
    filterset_fields = ['is_active', 'groups__name', 'offices']
    ordering_fields = ['username', 'last_login', 'date_joined']

    def perform_create(self, serializer):
        user = serializer.save()
        log(self.request, 'create', user, f'Created user {user.username}', {'after': user_snapshot(user)})

    def perform_update(self, serializer):
        user = serializer.instance
        if user == self.request.user and serializer.validated_data.get('is_active') is False:
            raise serializers.ValidationError({'is_active': 'You cannot deactivate your own account.'})
        before = user_snapshot(user)
        user = serializer.save()
        log(self.request, 'update', user, f'Updated user {user.username}', diff(before, user_snapshot(user)))

    @action(detail=True, methods=['post'], url_path='reset-password')
    def reset_password(self, request, pk=None):
        """Admin sets a temporary password; the user must change it at next login."""
        user = self.get_object()
        s = PasswordSerializer(data=request.data, context={'user': user})
        s.is_valid(raise_exception=True)
        user.set_password(s.validated_data['new_password'])
        user.must_change_password = True
        user.save()
        log(request, 'password_reset', user, f'Password reset for {user.username}')
        return Response(status=status.HTTP_204_NO_CONTENT)
