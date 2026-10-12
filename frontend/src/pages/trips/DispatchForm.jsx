import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, invalidatePrefix, useList } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import PlaceSearch, { EMPTY_PLACE, useMapsEnabled } from '../../components/PlaceSearch'
import RouteEstimate from '../../components/RouteEstimate'
import { useAllOffices } from '../admin/Offices'
import { bookingLabel, bookingWindow, endOfDay, fromLocalInput, km, toLocalInput } from './common'
import { odometerField } from '../vehicles/common'

const DISPATCHABLE = ['SERVICEABLE', 'IN_USE']
const NOT_SCHEDULABLE = ['UNSERVICEABLE', 'DISPOSED'] // in repair now may be fine by the booked date

const common = {
  ticket_number: z.string().max(40),
  vehicle: z.string().min(1, 'Select a vehicle'),
  driver: z.string().min(1, 'Select a driver'),
  requesting_office: z.string(),
  passengers: z.string(),
  origin: z.string().trim().min(1, 'Origin is required').max(200),
  destination: z.string().trim().min(1, 'Destination is required').max(255),
  purpose: z.string().trim().min(1, 'Purpose is required'),
  remarks: z.string(),
}
const schemas = {
  dispatch: z.object({
    ...common,
    departed_at: z.string().min(1, 'Departure time is required'),
    odometer_start: odometerField(),
  }),
  schedule: z.object({
    ...common,
    scheduled_departure: z.string().min(1, 'Choose the departure date and time'),
    scheduled_return: z.string(),
  }).refine((v) => !v.scheduled_return || v.scheduled_return >= v.scheduled_departure,
    { path: ['scheduled_return'], message: 'Expected return cannot be before the departure' }),
}

// Tomorrow 8:00 AM, a sensible default for a booking.
const tomorrowAt8 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return toLocalInput(d) }

const isoDay = (d) => d.toLocaleDateString('en-CA')
const validDate = (d) => d instanceof Date && !isNaN(d)

/**
 * Which vehicles/drivers are already booked for a time. Pass {start, end} for a booking window
 * (end empty = rest of that day) or {point} for "leaving now". Mirrors the server's rules; the server decides.
 */
export function useAvailability({ start, end, point, excludeId }) {
  const from = point ?? start
  const ok = validDate(from)
  const to = validDate(end) ? end : from
  const q = useList('/trips/', ok
    ? { status: 'SCHEDULED', date_from: isoDay(new Date(from.getTime() - 7 * 864e5)), date_to: isoDay(to), page_size: 500 }
    : { status: 'SCHEDULED', page_size: 1 })
  const bookings = ok ? (q.data?.results ?? []).filter((b) => b.id !== excludeId) : []
  const windowEnd = validDate(end) ? end : ok ? endOfDay(from) : null
  const hits = (b) => {
    const [os, oe] = bookingWindow(b)
    return point ? os <= point && point < oe : os < windowEnd && from < oe
  }
  const clash = (key, id) => bookings.find((b) => b[key] === Number(id) && hits(b))
  return {
    vehicleClash: (id) => clash('vehicle', id),
    driverClash: (id) => clash('driver', id),
    vehicleDay: (id) => bookings.filter((b) => b.vehicle === Number(id) && isoDay(new Date(b.scheduled_departure)) === isoDay(from)),
  }
}

/**
 * Modal body. mode="dispatch": the vehicle leaves now (odometer required).
 * mode="schedule": book ahead; the odometer is entered on the day, when it is dispatched.
 * `vehicle` (optional) pre-selects and locks the vehicle, e.g. from a vehicle's Trips tab.
 */
export default function DispatchForm({ vehicle, mode = 'dispatch', onClose, onSaved }) {
  const scheduling = mode === 'schedule'
  const schema = schemas[mode]
  const FIELDS = Object.keys(schema.shape) // zod v4 keeps .shape after .refine()
  const qc = useQueryClient()
  const toast = useToast()
  const offices = useAllOffices()
  const vehicles = useList('/vehicles/', { page_size: 500 }) // ponytail: fine for a regional fleet; switch to a search box past ~500
  const drivers = useList('/drivers/', { page_size: 500, is_active: true })
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      ...Object.fromEntries(FIELDS.map((k) => [k, ''])),
      vehicle: vehicle ? String(vehicle.id) : '',
      ...(scheduling
        ? { scheduled_departure: tomorrowAt8(), scheduled_return: '' }
        : { departed_at: toLocalInput(), odometer_start: vehicle ? String(vehicle.current_odometer) : '' }),
    },
  })
  const chosen = vehicles.data?.results.find((v) => String(v.id) === watch('vehicle')) ?? vehicle
  // Origin/destination: the text is the record; coordinates and the route line come from the map when available.
  const mapsOn = useMapsEnabled()
  const [origin, setOrigin] = useState(EMPTY_PLACE)
  const [dest, setDest] = useState(EMPTY_PLACE)
  const [estimate, setEstimate] = useState(null)

  const save = useMutation({
    mutationFn: (body) => api.post(scheduling ? '/trips/schedule/' : '/trips/', body),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/trips/', '/vehicles/')
      toast(scheduling ? `Trip ${data.ticket_number} scheduled.` : `Trip ${data.ticket_number} dispatched.`)
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => save.mutate({
    ...v,
    estimated_distance_km: estimate ? String(estimate.distance_km) : null,
    estimated_duration_min: estimate ? estimate.duration_min : null,
    origin_lat: estimate ? estimate.origin[0].toFixed(6) : null,
    origin_lng: estimate ? estimate.origin[1].toFixed(6) : null,
    destination_lat: estimate ? estimate.destination[0].toFixed(6) : null,
    destination_lng: estimate ? estimate.destination[1].toFixed(6) : null,
    route_geometry: estimate ? estimate.geometry : null,
    vehicle: Number(v.vehicle),
    driver: Number(v.driver),
    requesting_office: v.requesting_office ? Number(v.requesting_office) : null,
    ...(scheduling
      ? { scheduled_departure: fromLocalInput(v.scheduled_departure),
          scheduled_return: v.scheduled_return ? fromLocalInput(v.scheduled_return) : null }
      : { departed_at: fromLocalInput(v.departed_at), odometer_start: Number(v.odometer_start) }),
  })
  const usable = (v) => (scheduling ? !NOT_SCHEDULABLE.includes(v.status) : DISPATCHABLE.includes(v.status))

  const text = (name, label, { hint, ...props } = {}) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message} hint={hint}>
      <input id={name} className={inputClass} {...register(name)} {...props} />
    </Field>
  )
  const vehicleField = register('vehicle')

  const chosenDriver = drivers.data?.results.find((d) => String(d.id) === watch('driver'))
  const when = (name) => (watch(name) ? new Date(watch(name)) : null)
  const avail = useAvailability(scheduling
    ? { start: when('scheduled_departure'), end: when('scheduled_return') }
    : { point: when('departed_at') })
  const vehicleBusy = chosen && avail.vehicleClash(chosen.id)
  const driverBusy = chosenDriver && avail.driverClash(chosenDriver.id)
  const dayBookings = chosen ? avail.vehicleDay(chosen.id) : []

  return (
    <form noValidate className="space-y-5" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

      <Section step="1" title="Vehicle and driver">
        {vehicle ? (
          <div>
            <span className="mb-1 block text-sm font-medium">Vehicle</span>
            <input type="hidden" {...vehicleField} />
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{vehicle.plate_number} · {vehicle.make} {vehicle.model}</div>
          </div>
        ) : (
          <Field label="Vehicle *" htmlFor="vehicle" error={errors.vehicle?.message}>
            <select id="vehicle" className={inputClass} {...vehicleField}
              onChange={(e) => {
                vehicleField.onChange(e)
                const v = vehicles.data?.results.find((x) => String(x.id) === e.target.value)
                if (v) setValue('odometer_start', String(v.current_odometer))
              }}>
              <option value="">Select a vehicle…</option>
              {vehicles.data?.results.map((v) => (
                <option key={v.id} value={v.id} disabled={!usable(v) || !!avail.vehicleClash(v.id)}>
                  {v.plate_number} · {v.make} {v.model}{avail.vehicleClash(v.id) ? ` – booked ${bookingLabel(avail.vehicleClash(v.id))}` : v.status === 'SERVICEABLE' ? '' : ` (${v.status_display})`}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Driver *" htmlFor="driver" error={errors.driver?.message}
          hint={chosenDriver?.license_status === 'EXPIRING' ? `License expires ${chosenDriver.license_expiry_date}. Remind the driver to renew.` : undefined}>
          <select id="driver" className={inputClass} {...register('driver')}>
            <option value="">Select a driver…</option>
            {drivers.data?.results.map((d) => (
              <option key={d.id} value={d.id} disabled={d.license_status === 'EXPIRED' || !!avail.driverClash(d.id)}>
                {d.full_name} ({d.office_code}){avail.driverClash(d.id) ? ` – booked ${bookingLabel(avail.driverClash(d.id))}` : d.license_status === 'EXPIRED' ? ' – license expired' : d.license_status === 'EXPIRING' ? ' – license expiring' : ''}
              </option>
            ))}
          </select>
        </Field>
        {chosen && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-brand-light/50 px-3 py-2 text-sm sm:col-span-2">
            <span><span className="text-slate-500">Status</span> <strong className="font-medium">{chosen.status_display}</strong></span>
            <span><span className="text-slate-500">Office</span> <strong className="font-medium">{chosen.office_code}</strong></span>
            <span><span className="text-slate-500">Odometer</span> <strong className="font-medium tabular-nums">{km(chosen.current_odometer)}</strong></span>
          </div>
        )}
        {(vehicleBusy || driverBusy) && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">
            {vehicleBusy && <p>Vehicle unavailable at this time: booked {bookingLabel(vehicleBusy)}.</p>}
            {driverBusy && <p>Driver unavailable at this time: booked {bookingLabel(driverBusy)}.</p>}
            <p className="text-xs">Pick another time{vehicle ? '' : ', vehicle'} or driver.</p>
          </div>
        )}
        {!vehicleBusy && dayBookings.length > 0 && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">
            <span className="font-medium text-ink">{chosen.plate_number} is also booked that day:</span>{' '}
            {dayBookings.map(bookingLabel).join(' · ')}
          </div>
        )}
      </Section>

      {scheduling ? (
        <Section step="2" title="Schedule">
          {text('scheduled_departure', 'Departure date and time *', { type: 'datetime-local', min: toLocalInput() })}
          {text('scheduled_return', 'Expected return', {
            type: 'datetime-local', hint: 'Optional. Without it, the vehicle and driver are held for the rest of that day.',
          })}
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2">
            No odometer yet. On the day of the trip, open it and press <strong>Dispatch</strong> to enter the current odometer.
          </p>
        </Section>
      ) : (
      <Section step="2" title="Departure">
        {text('departed_at', 'Date and time out *', { type: 'datetime-local' })}
        {text('odometer_start', 'Starting odometer (km) *', {
          inputMode: 'numeric',
          hint: chosen ? `Pre-filled from the vehicle (${km(chosen.current_odometer)}). Correct it if the dashboard shows more; it cannot be lower.` : 'Read it from the dashboard before leaving.',
        })}
      </Section>
      )}

      <Section step="3" title="Route and purpose">
        <input type="hidden" {...register('origin')} />
        <input type="hidden" {...register('destination')} />
        <Field label="Origin *" htmlFor="origin-search" error={errors.origin?.message}>
          <PlaceSearch id="origin-search" value={origin} enabled={mapsOn} invalid={!!errors.origin}
            placeholder={mapsOn ? 'Search a place, e.g. DOLE Regional Office III, San Fernando' : 'e.g. DOLE Regional Office'}
            onChange={(p) => { setOrigin(p); setEstimate(null); setValue('origin', p.text, { shouldValidate: !!errors.origin }) }} />
        </Field>
        <Field label="Destination *" htmlFor="destination-search" error={errors.destination?.message}>
          <PlaceSearch id="destination-search" value={dest} enabled={mapsOn} invalid={!!errors.destination}
            placeholder={mapsOn ? 'Search where the trip goes, e.g. Royce Hotel, Clark' : 'e.g. Provincial Office, Tarlac'}
            onChange={(p) => { setDest(p); setEstimate(null); setValue('destination', p.text, { shouldValidate: !!errors.destination }) }} />
        </Field>
        <RouteEstimate origin={origin} destination={dest} enabled={mapsOn} onEstimate={setEstimate} />
        <div className="sm:col-span-2">
          <Field label="Purpose *" htmlFor="purpose" error={errors.purpose?.message}>
            <textarea id="purpose" rows={2} className={inputClass} placeholder="e.g. Labor inspection, document delivery" {...register('purpose')} />
          </Field>
        </div>
      </Section>

      <Section step="4" title="Other details" note="Optional">
        <Field label="Requesting office" htmlFor="requesting_office" error={errors.requesting_office?.message}>
          <select id="requesting_office" className={inputClass} {...register('requesting_office')}>
            <option value="">None</option>
            {offices.data?.results.filter((o) => o.is_active).map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
          </select>
        </Field>
        {text('ticket_number', 'Trip ticket no.', {
          placeholder: 'Auto-numbered if blank', className: `${inputClass} uppercase`,
          hint: 'Type the paper trip ticket number, or leave blank for TT-YYYY-00001.',
        })}
        <Field label="Passengers" htmlFor="passengers" error={errors.passengers?.message}>
          <textarea id="passengers" rows={2} className={inputClass} placeholder="One name per line" {...register('passengers')} />
        </Field>
        <Field label="Remarks" htmlFor="remarks" error={errors.remarks?.message}>
          <textarea id="remarks" rows={2} className={inputClass} {...register('remarks')} />
        </Field>
      </Section>

      <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : scheduling ? 'Schedule trip' : 'Dispatch trip'}</Button>
      </div>
    </form>
  )
}

function Section({ step, title, note, children }) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-brand">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] text-white" aria-hidden="true">{step}</span>
        {title}{note && <span className="font-normal text-slate-400">· {note}</span>}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}
