"""Upload / replace / remove the `photo` of a vehicle or driver. Shared so both follow the same rules."""
from django.db import transaction

from audit.services import log

from .serializers import PhotoSerializer


def change_photo(request, obj):
    """POST multipart `photo` uploads or replaces; DELETE removes. Validated (JPEG/PNG/WebP, size), audited,
    and the obsolete file is deleted after the transaction commits."""
    old = obj.photo.name if obj.photo else None
    label = f'{obj._meta.verbose_name} {obj}'

    if request.method == 'DELETE':
        if not old:
            return
        obj.photo = None
        obj.save(update_fields=['photo', 'updated_at'])
        log(request, 'photo_remove', obj, f'Removed photo of {label}', {'photo': [old, None]})
    else:
        s = PhotoSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        obj.photo = s.validated_data['photo']
        obj.save(update_fields=['photo', 'updated_at'])
        log(request, 'photo_replace' if old else 'photo_upload', obj,
            f'{"Replaced" if old else "Uploaded"} photo of {label}', {'photo': [old, obj.photo.name]})

    if old:
        # ponytail: obsolete photos are deleted immediately; switch to a retention job if policy requires keeping them.
        storage = obj.photo.storage
        transaction.on_commit(lambda: storage.delete(old))
