import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, CalendarClock, CalendarX, Check, CircleCheck, Clock, Gauge, MapPin, Navigation, Pencil, Repeat, Users, X, XCircle } from 'lucide-react'
import { api, applyFieldErrors, errorMessage, invalidatePrefix, useList } from '../../api'
import { useCan } from '../../auth'
import Attachments from '../../components/Attachments'
import { Button, Field, formatDateTime, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { NotFound } from '../Errors'
import { useAllOffices } from '../admin/Offices'
import { bookingLabel, fromLocalInput, km, toLocalInput, tripDuration, TripStatusBadge } from './common'
import { useAvailability } from './DispatchForm'
import { odometerField, parseKm, VehiclePhoto } from '../vehicles/common'
import { Avatar } from '../../components/filters'

export default function TripDetail() {
  const { id } = useParams()
  const can = useCan()
  const [dialog, setDialog] = useState(null) // 'complete' | 'cancel' | 'edit'
  const query = useQuery({ queryKey: ['/trips/', id], queryFn: () => api.get(`/trips/${id}/`).then((r) => r.data) })
  const t = query.data

  if (query.isLoading) return <div className="animate-pulse space-y-3"><div className="h-8 w-56 rounded bg-slate-200" /><div className="h-56 rounded-xl bg-slate-200" /></div>
  if (query.error?.response?.status === 404) return <NotFound />
  if (query.isError) return <div className="text-danger">{errorMessage(query.error)}</div>

  const canChange = can('operations.change_trip')
  const open = t.status === 'DISPATCHED'
  const scheduled = t.status === 'SCHEDULED'
  const leaves = t.scheduled_departure && formatDateTime(t.scheduled_departure)

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/trips" className="hover:underline">Trips</Link> / <span aria-current="page">{t.ticket_number}</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold text-brand">{t.ticket_number}</h1>
            <TripStatusBadge status={t.status} />
          </div>
          <p className="text-slate-600">{t.purpose}</p>
        </div>
        {canChange && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil size={16} /> Edit details</Button>}
        {canChange && scheduled && <Button variant="secondary" onClick={() => setDialog('reschedule')}><Repeat size={16} /> Reschedule</Button>}
        {canChange && (open || scheduled) && <Button variant="secondary" className="text-danger" onClick={() => setDialog('cancel')}><XCircle size={16} /> Cancel trip</Button>}
      </div>

      <TripProgress trip={t} />

      {scheduled && t.schedule_day === 'TODAY' && (
        <Banner tone="amber" icon={Navigation} text={<><strong className="font-semibold">Leaves today ({leaves}).</strong> When the vehicle is about to leave, press Dispatch and enter the current odometer.</>}>
          {canChange && <Button onClick={() => setDialog('dispatch')}><Navigation size={16} /> Dispatch: enter odometer</Button>}
        </Banner>
      )}
      {scheduled && t.schedule_day === 'UPCOMING' && (
        <Banner tone="slate" icon={CalendarClock} text={<><strong className="font-semibold">Scheduled for {leaves}.</strong> On that day, open this trip and press Dispatch to enter the odometer.</>} />
      )}
      {scheduled && t.schedule_day === 'MISSED' && (
        <Banner tone="red" icon={CalendarX} text={<><strong className="font-semibold">Missed:</strong> this trip was scheduled for {leaves} and was not dispatched. Reschedule or cancel it.</>}>
          {canChange && <Button onClick={() => setDialog('reschedule')}><Repeat size={16} /> Reschedule</Button>}
        </Banner>
      )}

      {open && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand/20 bg-brand-light/60 px-4 py-3">
          <Clock size={18} className="text-brand" aria-hidden="true" />
          <p className="mr-auto text-sm text-ink">
            <strong className="font-semibold">Out for {tripDuration(t.departed_at)}.</strong>{' '}
            Record the return with the ending odometer when the vehicle is back.
          </p>
          {canChange && <Button onClick={() => setDialog('complete')}><CircleCheck size={16} /> Record return</Button>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Route">
            <ol className="space-y-1">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand"><MapPin size={15} aria-hidden="true" /></span>
                <div><div className="text-xs text-slate-500">Origin</div><div className="font-medium">{t.origin}</div></div>
              </li>
              <li className="pl-2 text-slate-300" aria-hidden="true"><ArrowDown size={16} /></li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"><MapPin size={15} aria-hidden="true" /></span>
                <div><div className="text-xs text-slate-500">Destination / places visited</div><div className="font-medium whitespace-pre-line">{t.destination}</div></div>
              </li>
            </ol>
          </Card>

          <Card title="Time and odometer">
            <div className="grid gap-4 sm:grid-cols-3">
              {t.scheduled_departure && <>
                <Metric icon={CalendarClock} label="Scheduled departure" value={leaves} />
                <Metric icon={CalendarClock} label="Expected return" value={t.scheduled_return ? formatDateTime(t.scheduled_return) : '—'} />
                <div className="hidden sm:block" />
              </>}
              <Metric icon={CalendarClock} label="Departed" value={t.departed_at ? formatDateTime(t.departed_at) : scheduled ? 'Not yet' : '—'} />
              <Metric icon={CalendarClock} label="Returned" value={t.returned_at ? formatDateTime(t.returned_at) : open ? 'Not yet returned' : '—'} />
              <Metric icon={CalendarClock} label={open ? 'Out for' : 'Duration'}
                value={t.departed_at && t.status !== 'CANCELLED' ? tripDuration(t.departed_at, t.returned_at) : '—'} />
              <Metric icon={Gauge} label="Odometer out" value={scheduled ? 'Entered at dispatch' : km(t.odometer_start)} />
              <Metric icon={Gauge} label="Odometer in" value={km(t.odometer_end)} />
              <Metric icon={Gauge} label="Distance" value={km(t.distance_km)} strong />
            </div>
          </Card>

          <Attachments basePath={`/trips/${t.id}`} canChange={canChange} title="Trip ticket scans and attachments" />
        </div>

        <div className="space-y-4">
          <Card title="Vehicle and driver">
            <Link to={`/vehicles/${t.vehicle}`} className="block" aria-label={`Open vehicle ${t.plate_number}`}>
              <VehiclePhoto vehicle={{ photo_url: t.vehicle_photo_url, plate_number: t.plate_number, make: '', model: t.vehicle_label }} className="border border-slate-200" />
            </Link>
            <dl className="mt-4 space-y-4 text-sm">
              <Item label="Vehicle" value={<Link to={`/vehicles/${t.vehicle}`} className="font-semibold text-brand hover:underline">{t.plate_number}</Link>} hint={`${t.vehicle_label} · ${t.office_code}`} />
              <div className="flex items-center gap-3">
                <Avatar name={t.driver_name} src={t.driver_photo_url} className="h-12! w-12! text-base" />
                <div><dt className="text-xs text-slate-500">Driver</dt><dd><Link to={`/drivers/${t.driver}`} className="font-semibold text-brand hover:underline">{t.driver_name}</Link></dd></div>
              </div>
              <Item label="Requesting office" value={t.requesting_office_name ?? '—'} />
            </dl>
          </Card>
          <Card title="Passengers" icon={Users}>
            {t.passengers ? <p className="text-sm whitespace-pre-line">{t.passengers}</p> : <p className="text-sm text-slate-500">None recorded.</p>}
          </Card>
          {t.remarks && <Card title="Remarks"><p className="text-sm whitespace-pre-line">{t.remarks}</p></Card>}
          <p className="text-xs text-slate-400">Created {formatDateTime(t.created_at)} · Updated {formatDateTime(t.updated_at)}</p>
        </div>
      </div>

      <Modal open={dialog === 'dispatch'} onClose={() => setDialog(null)} title={`Dispatch ${t.ticket_number}`}>
        {dialog === 'dispatch' && <DispatchScheduledForm trip={t} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'reschedule'} onClose={() => setDialog(null)} title={`Reschedule ${t.ticket_number}`} wide>
        {dialog === 'reschedule' && <RescheduleForm trip={t} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'complete'} onClose={() => setDialog(null)} title={`Record return: ${t.ticket_number}`}>
        {dialog === 'complete' && <CompleteForm trip={t} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'cancel'} onClose={() => setDialog(null)} title={`Cancel ${t.ticket_number}`}>
        {dialog === 'cancel' && <CancelForm trip={t} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'edit'} onClose={() => setDialog(null)} title={`Edit ${t.ticket_number}`} wide>
        {dialog === 'edit' && <EditForm trip={t} onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}

/** Dispatched -> Out on trip -> Returned (or Cancelled), with timestamps. Text labels carry the meaning, not color. */
function TripProgress({ trip: t }) {
  const cancelled = t.status === 'CANCELLED'
  const done = t.status === 'COMPLETED'
  const ended = cancelled
    ? { label: 'Cancelled', detail: formatDateTime(t.updated_at), state: 'cancelled' }
    : { label: 'Returned', detail: done ? formatDateTime(t.returned_at) : 'Pending', state: done ? 'done' : 'todo' }
  const steps = []
  if (t.scheduled_departure) {
    steps.push({ label: 'Scheduled', detail: formatDateTime(t.scheduled_departure), state: t.status === 'SCHEDULED' ? 'current' : 'done' })
  }
  if (!t.departed_at) {
    steps.push({ label: 'Dispatched', detail: cancelled ? 'Not dispatched' : 'On the day, with odometer', state: cancelled ? 'skipped' : 'todo' }, ended)
  } else {
    steps.push(
      { label: 'Dispatched', detail: formatDateTime(t.departed_at), state: 'done' },
      { label: 'Out on trip', detail: cancelled ? 'Did not complete' : done ? tripDuration(t.departed_at, t.returned_at) : `${tripDuration(t.departed_at)} so far`,
        state: done ? 'done' : cancelled ? 'skipped' : 'current' },
      ended,
    )
  }
  const dot = {
    done: 'bg-brand text-white',
    current: 'bg-white text-brand ring-2 ring-brand',
    todo: 'bg-white text-slate-400 ring-2 ring-slate-200',
    skipped: 'bg-slate-100 text-slate-400 ring-2 ring-slate-200',
    cancelled: 'bg-slate-500 text-white',
  }
  return (
    <ol aria-label="Trip progress" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      className="mb-4 grid rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      {steps.map((st, i) => (
        <li key={st.label} className="relative flex flex-col items-center text-center" aria-current={st.state === 'current' ? 'step' : undefined}>
          {i > 0 && (
            <span aria-hidden="true" className={`absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2 ${
              st.state === 'done' || st.state === 'current' ? 'bg-brand' : 'bg-slate-200'}`} />
          )}
          <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${dot[st.state]}`}>
            {st.state === 'done' ? <Check size={16} aria-hidden="true" /> : st.state === 'cancelled' ? <X size={16} aria-hidden="true" /> : i + 1}
          </span>
          <span className="mt-2 text-sm font-semibold">{st.label}</span>
          <span className="text-xs text-slate-500">{st.detail}</span>
        </li>
      ))}
    </ol>
  )
}

function Banner({ tone, icon: Icon, text, children }) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    slate: 'border-slate-200 bg-slate-50 text-ink',
    red: 'border-red-200 bg-red-50 text-danger',
  }
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${tones[tone]}`}>
      <Icon size={18} aria-hidden="true" />
      <p className="mr-auto text-sm">{text}</p>
      {children}
    </div>
  )
}

function useTripMutation(trip, path, message, onClose, setError, fields) {
  const qc = useQueryClient()
  const toast = useToast()
  const [error, setFormError] = useState('')
  const m = useMutation({
    mutationFn: (body) => (path ? api.post(`/trips/${trip.id}/${path}/`, body) : api.patch(`/trips/${trip.id}/`, body)),
    onSuccess: ({ data }) => {
      qc.setQueryData(['/trips/', String(trip.id)], data)
      invalidatePrefix(qc, '/trips/', '/vehicles/')
      toast(message)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, fields)),
  })
  return [m, error]
}

const completeSchema = z.object({
  returned_at: z.string().min(1, 'Return time is required'),
  odometer_end: odometerField(),
  remarks: z.string(),
})

export function CompleteForm({ trip, onClose }) {
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(completeSchema),
    defaultValues: { returned_at: toLocalInput(), odometer_end: '', remarks: trip.remarks ?? '' },
  })
  const [save, error] = useTripMutation(trip, 'complete', 'Trip completed. Vehicle odometer updated.', onClose, setError, ['returned_at', 'odometer_end', 'remarks'])
  const end = Number(parseKm(watch('odometer_end')))
  const distance = end >= trip.odometer_start ? end - trip.odometer_start : null

  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => save.mutate({
      returned_at: fromLocalInput(v.returned_at), odometer_end: Number(v.odometer_end), remarks: v.remarks,
    }))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <Field label="Returned at *" htmlFor="returned_at" error={errors.returned_at?.message}>
        <input id="returned_at" type="datetime-local" max={toLocalInput()} className={inputClass} {...register('returned_at')} />
      </Field>
      <Field label="Ending odometer (km) *" htmlFor="odometer_end" error={errors.odometer_end?.message}
        hint={`Started at ${km(trip.odometer_start)}.${distance != null && watch('odometer_end') ? ` Distance: ${km(distance)}.` : ''}`}>
        <input id="odometer_end" inputMode="numeric" autoFocus className={inputClass} {...register('odometer_end')} />
      </Field>
      <Field label="Remarks" htmlFor="remarks" error={errors.remarks?.message}>
        <textarea id="remarks" rows={2} className={inputClass} {...register('remarks')} />
      </Field>
      <p className="text-xs text-slate-500">The vehicle&apos;s odometer moves to the ending reading and the vehicle becomes available again.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Complete trip'}</Button>
      </div>
    </form>
  )
}

function CancelForm({ trip, onClose }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: zodResolver(z.object({ reason: z.string().trim().min(1, 'Give a reason').max(500) })),
  })
  const [save, error] = useTripMutation(trip, 'cancel', 'Trip cancelled.', onClose, setError, ['reason'])
  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <p className="text-sm text-slate-600">The trip stays on record as cancelled. The vehicle&apos;s odometer is not changed.</p>
      <Field label="Reason *" htmlFor="reason" error={errors.reason?.message}>
        <textarea id="reason" rows={2} autoFocus className={inputClass} {...register('reason')} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button variant="danger" type="submit" disabled={save.isPending}>Cancel trip</Button>
      </div>
    </form>
  )
}

const editSchema = z.object({
  requesting_office: z.string(),
  passengers: z.string(),
  origin: z.string().trim().min(1, 'Origin is required').max(200),
  destination: z.string().trim().min(1, 'Destination is required').max(255),
  purpose: z.string().trim().min(1, 'Purpose is required'),
  remarks: z.string(),
})

function EditForm({ trip, onClose }) {
  const offices = useAllOffices()
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: zodResolver(editSchema),
    defaultValues: {
      requesting_office: trip.requesting_office ? String(trip.requesting_office) : '', passengers: trip.passengers,
      origin: trip.origin, destination: trip.destination, purpose: trip.purpose, remarks: trip.remarks,
    },
  })
  const [save, error] = useTripMutation(trip, null, 'Trip updated.', onClose, setError, Object.keys(editSchema.shape))
  const area = (name, label) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message}>
      <textarea id={name} rows={2} className={inputClass} {...register(name)} />
    </Field>
  )
  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate({
      ...v, requesting_office: v.requesting_office ? Number(v.requesting_office) : null,
    }))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}
      <p className="text-xs text-slate-500 sm:col-span-2">Vehicle, driver, times and odometer readings can&apos;t be edited here; they change only by recording the return or cancelling.</p>
      <Field label="Origin *" htmlFor="origin" error={errors.origin?.message}>
        <input id="origin" className={inputClass} {...register('origin')} />
      </Field>
      <Field label="Requesting office" htmlFor="requesting_office" error={errors.requesting_office?.message}>
        <select id="requesting_office" className={inputClass} {...register('requesting_office')}>
          <option value="">None</option>
          {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">{area('destination', 'Destination / places visited *')}</div>
      <div className="sm:col-span-2">{area('purpose', 'Purpose *')}</div>
      {area('passengers', 'Passengers')}
      {area('remarks', 'Remarks')}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )
}

function Card({ title, icon: Icon, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand">{Icon && <Icon size={16} aria-hidden="true" />}{title}</h2>
      {children}
    </section>
  )
}

function Metric({ icon: Icon, label, value, strong }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className={strong ? 'text-lg font-semibold text-brand' : 'font-medium'}>{value}</div>
      </div>
    </div>
  )
}

function Item({ label, value, hint }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd>{value}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  )
}

const dispatchSchema = z.object({
  departed_at: z.string().min(1, 'Departure time is required'),
  odometer_start: odometerField(),
})

/** Scheduled trip leaves today: read the odometer now. */
export function DispatchScheduledForm({ trip, onClose }) {
  const vehicle = useQuery({
    queryKey: ['/vehicles/', String(trip.vehicle)],
    queryFn: () => api.get(`/vehicles/${trip.vehicle}/`).then((r) => r.data),
  })
  const { register, handleSubmit, setError, setValue, getValues, formState: { errors } } = useForm({
    resolver: zodResolver(dispatchSchema), defaultValues: { departed_at: toLocalInput(), odometer_start: '' },
  })
  useEffect(() => {
    if (vehicle.data && !getValues('odometer_start')) setValue('odometer_start', String(vehicle.data.current_odometer))
  }, [vehicle.data, getValues, setValue])
  const [save, error] = useTripMutation(trip, 'dispatch', 'Trip dispatched. Vehicle is now in use.', onClose, setError, ['departed_at', 'odometer_start'])

  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => save.mutate({
      departed_at: fromLocalInput(v.departed_at), odometer_start: Number(v.odometer_start),
    }))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <p className="text-sm text-slate-600">{trip.plate_number} with {trip.driver_name} to {trip.destination}.</p>
      <Field label="Current odometer (km) *" htmlFor="odometer_start" error={errors.odometer_start?.message}
        hint={vehicle.data ? `Last recorded: ${km(vehicle.data.current_odometer)}. Read the dashboard now; it cannot be lower.` : 'Read it from the dashboard now.'}>
        <input id="odometer_start" inputMode="numeric" autoFocus className={inputClass} {...register('odometer_start')} />
      </Field>
      <Field label="Departure time *" htmlFor="departed_at" error={errors.departed_at?.message} hint="Today only.">
        <input id="departed_at" type="datetime-local" max={toLocalInput()} className={inputClass} {...register('departed_at')} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Dispatching…' : 'Dispatch trip'}</Button>
      </div>
    </form>
  )
}

const rescheduleSchema = z.object({
  vehicle: z.string().min(1, 'Select a vehicle'),
  driver: z.string().min(1, 'Select a driver'),
  scheduled_departure: z.string().min(1, 'Choose the departure date and time'),
  scheduled_return: z.string(),
}).refine((v) => !v.scheduled_return || v.scheduled_return >= v.scheduled_departure,
  { path: ['scheduled_return'], message: 'Expected return cannot be before the departure' })

function RescheduleForm({ trip, onClose }) {
  const vehicles = useList('/vehicles/', { page_size: 500 })
  const drivers = useList('/drivers/', { page_size: 500, is_active: true })
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(rescheduleSchema),
    defaultValues: {
      vehicle: String(trip.vehicle), driver: String(trip.driver),
      scheduled_departure: toLocalInput(trip.scheduled_departure),
      scheduled_return: trip.scheduled_return ? toLocalInput(trip.scheduled_return) : '',
    },
  })
  const when = (name) => (watch(name) ? new Date(watch(name)) : null)
  const avail = useAvailability({ start: when('scheduled_departure'), end: when('scheduled_return'), excludeId: trip.id })
  const vehicleBusy = avail.vehicleClash(watch('vehicle'))
  const driverBusy = avail.driverClash(watch('driver'))
  const [save, error] = useTripMutation(trip, 'reschedule', 'Trip rescheduled.', onClose, setError, Object.keys(rescheduleSchema.shape))
  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate({
      vehicle: Number(v.vehicle), driver: Number(v.driver), scheduled_departure: fromLocalInput(v.scheduled_departure),
      scheduled_return: v.scheduled_return ? fromLocalInput(v.scheduled_return) : null,
    }))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}
      <Field label="Vehicle *" htmlFor="vehicle" error={errors.vehicle?.message}>
        <select id="vehicle" className={inputClass} {...register('vehicle')}>
          {vehicles.data?.results.map((v) => (
            <option key={v.id} value={v.id} disabled={['UNSERVICEABLE', 'DISPOSED'].includes(v.status) || !!avail.vehicleClash(v.id)}>
              {v.plate_number} · {v.make} {v.model}{avail.vehicleClash(v.id) ? ` – booked ${bookingLabel(avail.vehicleClash(v.id))}` : v.status === 'SERVICEABLE' ? '' : ` (${v.status_display})`}
            </option>
          )) ?? <option value={trip.vehicle}>{trip.plate_number}</option>}
        </select>
      </Field>
      <Field label="Driver *" htmlFor="driver" error={errors.driver?.message}>
        <select id="driver" className={inputClass} {...register('driver')}>
          {drivers.data?.results.map((d) => (
            <option key={d.id} value={d.id} disabled={d.license_status === 'EXPIRED' || !!avail.driverClash(d.id)}>
              {d.full_name} ({d.office_code}){avail.driverClash(d.id) ? ` – booked ${bookingLabel(avail.driverClash(d.id))}` : ''}
            </option>
          )) ?? <option value={trip.driver}>{trip.driver_name}</option>}
        </select>
      </Field>
      <Field label="Departure date and time *" htmlFor="scheduled_departure" error={errors.scheduled_departure?.message}>
        <input id="scheduled_departure" type="datetime-local" min={toLocalInput()} className={inputClass} {...register('scheduled_departure')} />
      </Field>
      <Field label="Expected return" htmlFor="scheduled_return" error={errors.scheduled_return?.message}>
        <input id="scheduled_return" type="datetime-local" className={inputClass} {...register('scheduled_return')} />
      </Field>
      {(vehicleBusy || driverBusy) && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">
          {vehicleBusy && <p>Vehicle unavailable at this time: booked {bookingLabel(vehicleBusy)}.</p>}
          {driverBusy && <p>Driver unavailable at this time: booked {bookingLabel(driverBusy)}.</p>}
        </div>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Reschedule'}</Button>
      </div>
    </form>
  )
}
