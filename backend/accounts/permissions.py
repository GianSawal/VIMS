from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission, DjangoModelPermissions

VIEW_ALL_OFFICES = 'accounts.view_all_offices'


class SessionAuth(SessionAuthentication):
    """Session auth that answers 401 (not 403) when logged out, so the SPA can tell 'expired' from 'forbidden'."""
    def authenticate_header(self, request):
        return 'Session'


class PasswordChangeNotRequired(BasePermission):
    message = 'You must change your password before continuing.'

    def has_permission(self, request, view):
        if getattr(view, 'allow_pending_password_change', False):
            return True
        return not getattr(request.user, 'must_change_password', False)


class ModelPermissions(DjangoModelPermissions):
    """Django model perms, with reads also requiring view_<model>."""
    perms_map = {
        **DjangoModelPermissions.perms_map,
        'GET': ['%(app_label)s.view_%(model_name)s'],
        'HEAD': ['%(app_label)s.view_%(model_name)s'],
    }


def require(*perms):
    """Permission class needing all `perms`; for custom actions where POST/DELETE don't mean add/delete."""
    class Required(BasePermission):
        message = 'You do not have permission to perform this action.'

        def has_permission(self, request, view):
            return request.user.is_authenticated and request.user.has_perms(perms)
    return Required


def scope_to_offices(qs, user, office_field):
    """Limit a queryset to the user's offices unless they may see all offices."""
    if office_field is None or user.has_perm(VIEW_ALL_OFFICES):
        return qs
    return qs.filter(**{f'{office_field}__in': user.offices.all()})


def check_office_access(user, office):
    if office is not None and not user.has_perm(VIEW_ALL_OFFICES) and not user.offices.filter(pk=office.pk).exists():
        raise PermissionDenied('You do not have access to this office.')


class OfficeScopedMixin:
    """
    For ModelViewSets: model permissions + office scoping on reads and writes.
    `office_field` is the lookup path from the model to Office ('office', 'vehicle__office', 'pk' for Office itself).
    Out-of-scope objects 404 rather than 403, so their existence isn't leaked.
    """
    office_field = 'office'
    permission_classes = [ModelPermissions, PasswordChangeNotRequired]

    def get_queryset(self):
        return scope_to_offices(super().get_queryset(), self.request.user, self.office_field)

    def perform_create(self, serializer):
        check_office_access(self.request.user, serializer.validated_data.get('office'))
        extra = {'created_by': self.request.user} if hasattr(serializer.Meta.model, 'created_by') else {}
        return serializer.save(**extra)

    def perform_update(self, serializer):
        check_office_access(self.request.user, serializer.validated_data.get('office'))
        return serializer.save()
