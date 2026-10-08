from .models import AuditLog


def diff(before, after):
    """{'field': [old, new]} for fields whose value changed."""
    return {k: [before.get(k), v] for k, v in after.items() if before.get(k) != v}


def log(request, action, entity, description, changes=None, user=None):
    """Append an audit entry. `entity` is a model instance or a string entity type."""
    user = user or (request.user if request.user.is_authenticated else None)
    if isinstance(entity, str):
        entity_type, entity_id = entity, ''
    else:
        entity_type, entity_id = entity._meta.label, str(entity.pk)
    return AuditLog.objects.create(
        user=user,
        username=user.username if user else '',
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        description=description[:500],
        changes=changes or {},
        ip_address=request.META.get('REMOTE_ADDR'),
        user_agent=request.META.get('HTTP_USER_AGENT', '')[:255],
    )
