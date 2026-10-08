from django.contrib import admin

from .models import FuelRecord, RFIDAccount, TollTransaction, Trip

admin.site.register([Trip, FuelRecord, RFIDAccount, TollTransaction])
