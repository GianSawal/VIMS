from django.db import migrations
from django.db.models.functions import Upper


def uppercase(apps, schema_editor):
    apps.get_model('fleet', 'VehicleAssignment').objects.update(
        accountable_person=Upper('accountable_person'), driver_name=Upper('driver_name'))


class Migration(migrations.Migration):
    dependencies = [('fleet', '0004_driver_photo')]
    operations = [migrations.RunPython(uppercase, migrations.RunPython.noop)]
