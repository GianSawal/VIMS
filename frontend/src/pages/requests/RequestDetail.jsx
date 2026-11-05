import { lazy, Suspense, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, CircleCheck, Phone, X, XCircle } from 'lucide-react'
import { api, applyFieldErrors, errorMessage, invalidatePrefix, useList } from '../../api'
import { useCan, useMe } from '../../auth'
import Attachments from '../../components/Attachments'
import { Avatar } from '../../components/filters'
import { Button, Field, formatDateTime, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { durationText } from '../../components/RouteEstimate'
import { NotFound } from '../Errors'
import { useAvailability } from '../trips/DispatchForm'
import { bookingLabel } from '../trips/common'
import { VehiclePhoto } from '../vehicles/common'
import { APPROVE, ProgressBadge } from './common'

const TripMap = lazy(() => import('../../components/TripMap'))

export default function RequestDetail() {
  const { id } = useParams()
  const can = useCan()
  const { data: me } = useMe()
  const [dialog, setDialog] = useState(null) // 'approve' | 'decline' | 'cancel'
  const query = useQuery({ queryKey: ['/vehicle-requests/', id], queryFn: () => api.get(`/vehicle-requests/${id}/`).then((r) => r.data) })
  const r = query.data

  if (query.isLoading) return <div className="animate-pulse space-y-3"><div className="h-8 w-56 rounded bg-slate-200" /><div className="h-56 rounded-xl bg-slate-200" /></div>
  if (query.error?.response?.status === 404) return <NotFound />
  if (query.isError) return <div className="text-danger">{errorMessage(query.error)}</div>

  const pending = r.status === 'PENDING'
  const mine = r.requester === me?.id
  const canDecide = pending && can(APPROVE)
  const canWithdraw = mine && (pending || r.progress === 'APPROVED')
  const hasMap = r.route_geometry?.length > 1 || (r.origin_lat != null && r.destination_lat != null)

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/requests" className="hover:underline">Vehicle requests</Link> / <span aria-current="page">{r.reference_number}</span>
      </nav>
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold text-brand">{r.reference_number}</h1>
            <ProgressBadge progress={r.progress} />
          </div>
          <p className="text-slate-600">{r.purpose}</p>
        </div>
        {canDecide && <Button onClick={() => setDialog('approve')}><CircleCheck size={16} /> Approve</Button>}
        {canDecide && <Button variant="secondary" className="text-danger" onClick={() => setDialog('decline')}><XCircle size={16} /> Decline</Button>}
        {canWithdraw && <Button variant="secondary" className="text-danger" onClick={() => setDialog('cancel')}><Ban size={16} /> Cancel request</Button>}
      </div>

      <RequestProgress r={r} />

      {r.decision_note && r.status !== 'APPROVED' && (
        <div role="status" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${r.status === 'DECLINED' ? 'border-red-200 bg-red-50 text-danger' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          <span className="font-semibold">{r.status === 'DECLINED' ? 'Declined' : 'Cancelled'}:</span> {r.decision_note}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Trip requested">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Item label="Needed" value={formatDateTime(r.needed_at)} />
              <Item label="Expected return" value={r.return_at ? formatDateTime(r.return_at) : 'Not given'} />
              <Item label="From" value={r.origin} />
              <Item label="To" value={r.destination} />
              <Item label="Requested by" value={`${r.requester_name} · ${r.office_code}`} />
              <Item label="Sent" value={formatDateTime(r.created_at)} />
              {r.estimated_distance_km != null && (
                <Item label="Map estimate" value={`≈ ${r.estimated_distance_km} km one way${r.estimated_duration_min != null ? `, about ${durationText(r.estimated_duration_min)}` : ''}`} />
              )}
            </dl>
            {hasMap && (
              <div className="mt-4">
                <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-slate-100" />}>
                  <TripMap route={r.route_geometry} className="h-64"
                    origin={r.origin_lat != null ? [Number(r.origin_lat), Number(r.origin_lng)] : null}
                    destination={r.destination_lat != null ? [Number(r.destination_lat), Number(r.destination_lng)] : null}
                    originLabel={r.origin} destinationLabel={r.destination} />
                </Suspense>
              </div>
            )}
          </Card>
          <Attachments basePath={`/vehicle-requests/${r.id}`} canChange={mine && can('operations.change_vehiclerequest')} title="Travel order and attachments" />
        </div>

        <div className="space-y-4">
          <BookedVehicle r={r} canOpenTrip={can('operations.view_trip')} />
          <Card title="Passengers">
            {r.passengers ? <p className="text-sm whitespace-pre-line">{r.passengers}</p> : <p className="text-sm text-slate-500">None listed.</p>}
          </Card>
          {r.remarks && <Card title="Remarks"><p className="text-sm whitespace-pre-line">{r.remarks}</p></Card>}
        </div>
      </div>

      <Modal open={dialog === 'approve'} onClose={() => setDialog(null)} title={`Approve ${r.reference_number}`} wide>
        {dialog === 'approve' && <ApproveForm r={r} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'decline'} onClose={() => setDialog(null)} title={`Decline ${r.reference_number}`}>
        {dialog === 'decline' && <ReasonForm r={r} path="decline" label="Reason for declining *" submit="Decline request" done="Request declined. The requester has been notified." onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'cancel'} onClose={() => setDialog(null)} title={`Cancel ${r.reference_number}`}>
        {dialog === 'cancel' && (
          <ReasonForm r={r} path="cancel" label="Why are you cancelling? *" submit="Cancel request" done="Request cancelled."
            note={r.trip ? `The booked trip ${r.trip.ticket_number} will be cancelled too.` : null} onClose={() => setDialog(null)} />
        )}
      </Modal>
    </div>
  )
}

/** Sent -> Approved/Declined/Cancelled -> Dispatched -> Completed, with timestamps. Labels carry the meaning. */
function RequestProgress({ r }) {
  const t = r.trip
  const steps = [{ label: 'Sent', detail: formatDateTime(r.created_at), state: 'done' }]
  if (r.status === 'PENDING') steps.push({ label: 'Approval', detail: 'Waiting for the fleet', state: 'current' })
  else if (r.status === 'DECLINED') steps.push({ label: 'Declined', detail: formatDateTime(r.decided_at), state: 'stopped' })
  else if (r.status === 'CANCELLED' && !t) steps.push({ label: 'Cancelled', detail: 'By the requester', state: 'stopped' })
  else steps.push({ label: 'Approved', detail: formatDateTime(r.decided_at), state: 'done' })

  if (t || r.status === 'PENDING') {
    const stopped = r.progress === 'CANCELLED'
    steps.push(t?.departed_at
      ? { label: 'Dispatched', detail: formatDateTime(t.departed_at), state: 'done' }
      : { label: stopped ? 'Cancelled' : 'Dispatched', detail: stopped ? 'Trip cancelled' : 'On the day', state: stopped ? 'stopped' : r.progress === 'APPROVED' ? 'current' : 'todo' })
    if (!stopped) {
      steps.push(t?.returned_at
        ? { label: 'Returned', detail: formatDateTime(t.returned_at), state: 'done' }
        : { label: 'Returned', detail: r.progress === 'DISPATCHED' ? 'On the road' : 'Pending', state: r.progress === 'DISPATCHED' ? 'current' : 'todo' })
    }
  }
  const dot = {
    done: 'bg-brand text-white',
    current: 'bg-white text-brand ring-2 ring-brand',
    todo: 'bg-white text-slate-400 ring-2 ring-slate-200',
    stopped: 'bg-slate-500 text-white',
  }
  return (
    <ol aria-label="Request progress" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      className="mb-4 grid rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      {steps.map((st, i) => (
        <li key={st.label + i} className="relative flex flex-col items-center text-center" aria-current={st.state === 'current' ? 'step' : undefined}>
          {i > 0 && <span aria-hidden="true" className={`absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2 ${st.state === 'todo' ? 'bg-slate-200' : 'bg-brand'}`} />}
          <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${dot[st.state]}`}>
            {st.state === 'done' ? <Check size={16} aria-hidden="true" /> : st.state === 'stopped' ? <X size={16} aria-hidden="true" /> : i + 1}
          </span>
          <span className="mt-2 text-sm font-semibold">{st.label}</span>
          <span className="text-xs text-slate-500">{st.detail}</span>
        </li>
      ))}
    </ol>
  )
}

function BookedVehicle({ r, canOpenTrip }) {
  const t = r.trip
  if (!t) {
    return (
      <Card title="Vehicle">
        <p className="text-sm text-slate-500">{r.status === 'PENDING' ? 'A vehicle is assigned when the request is approved.' : 'No vehicle was booked.'}</p>
      </Card>
    )
  }
  return (
    <Card title="Your vehicle">
      <VehiclePhoto vehicle={{ photo_url: t.vehicle_photo_url, plate_number: t.plate_number, make: '', model: t.vehicle_label }} className="border border-slate-200" />
      <dl className="mt-4 space-y-4 text-sm">
        <Item label="Vehicle" value={<span className="font-semibold tracking-wide">{t.plate_number}</span>} hint={t.vehicle_label} />
        <div className="flex items-center gap-3">
          <Avatar name={t.driver_name} src={t.driver_photo_url} className="h-12! w-12! text-base" />
          <div>
            <dt className="text-xs text-slate-500">Driver</dt>
            <dd>{t.driver_name
              ? <span className="font-semibold">{t.driver_name}</span>
              : <span className="font-medium text-amber-700">To be assigned before departure</span>}</dd>
            {t.driver_contact && (
              <dd><a href={`tel:${t.driver_contact}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Phone size={13} aria-hidden="true" />{t.driver_contact}</a></dd>
            )}
          </div>
        </div>
        <Item label="Trip ticket" value={canOpenTrip ? <Link to={`/trips/${t.id}`} className="font-mono font-semibold text-brand hover:underline">{t.ticket_number}</Link> : <span className="font-mono">{t.ticket_number}</span>} hint={t.status_display} />
        {r.decided_by_name && <Item label="Approved by" value={r.decided_by_name} hint={r.decision_note || undefined} />}
      </dl>
    </Card>
  )
}

function useRequestMutation(r, path, message, onClose, setError, fields) {
  const qc = useQueryClient()
  const toast = useToast()
  const [error, setFormError] = useState('')
  const m = useMutation({
    mutationFn: (body) => api.post(`/vehicle-requests/${r.id}/${path}/`, body),
    onSuccess: ({ data }) => {
      qc.setQueryData(['/vehicle-requests/', String(r.id)], data)
      invalidatePrefix(qc, '/vehicle-requests/', '/trips/', '/vehicles/', '/notifications/')
      toast(message)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, fields)),
  })
  return [m, error]
}

const approveSchema = z.object({ vehicle: z.string().min(1, 'Select a vehicle'), driver: z.string(), note: z.string().max(500) })
const NOT_SCHEDULABLE = ['UNSERVICEABLE', 'DISPOSED']

/** Book a vehicle (driver optional) for the requested time: creates the scheduled trip. */
function ApproveForm({ r, onClose }) {
  const vehicles = useList('/vehicles/', { page_size: 500, office: r.office, is_archived: false })  // only the requesting office's (the API checks too)
  const drivers = useList('/drivers/', { page_size: 500, is_active: true, office: r.office })  // same rule as vehicles (the API checks too)
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(approveSchema), defaultValues: { vehicle: '', driver: '', note: '' },
  })
  const avail = useAvailability({ start: new Date(r.needed_at), end: r.return_at ? new Date(r.return_at) : null })
  const vehicleBusy = avail.vehicleClash(watch('vehicle'))
  const driverBusy = avail.driverClash(watch('driver'))
  const [save, error] = useRequestMutation(r, 'approve', 'Request approved and trip booked. The requester has been notified.', onClose, setError, ['vehicle', 'driver', 'note'])

  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate({
      vehicle: Number(v.vehicle), driver: v.driver ? Number(v.driver) : null, note: v.note,
    }))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}
      <p className="rounded-md bg-brand-light/50 px-3 py-2 text-sm sm:col-span-2">
        {formatDateTime(r.needed_at)}{r.return_at ? ` – ${formatDateTime(r.return_at)}` : ' (rest of the day)'} · {r.office_code} to {r.destination}
      </p>
      <Field label="Vehicle *" htmlFor="vehicle" error={errors.vehicle?.message}>
        <select id="vehicle" className={inputClass} {...register('vehicle')}>
          <option value="">Select a vehicle…</option>
          {vehicles.data?.results.map((v) => (
            <option key={v.id} value={v.id} disabled={NOT_SCHEDULABLE.includes(v.status) || !!avail.vehicleClash(v.id)}>
              {v.plate_number} · {v.make} {v.model} ({v.office_code}){avail.vehicleClash(v.id) ? ` – booked ${bookingLabel(avail.vehicleClash(v.id))}` : v.status === 'SERVICEABLE' ? '' : ` – ${v.status_display}`}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Driver" htmlFor="driver" error={errors.driver?.message} hint="Optional now. Required when the trip is dispatched.">
        <select id="driver" className={inputClass} {...register('driver')}>
          <option value="">To be assigned later</option>
          {drivers.data?.results.map((d) => (
            <option key={d.id} value={d.id} disabled={d.license_status === 'EXPIRED' || !!avail.driverClash(d.id)}>
              {d.full_name} ({d.office_code}){avail.driverClash(d.id) ? ` – booked ${bookingLabel(avail.driverClash(d.id))}` : d.license_status === 'EXPIRED' ? ' – license expired' : ''}
            </option>
          ))}
        </select>
      </Field>
      {(vehicleBusy || driverBusy) && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">
          {vehicleBusy && <p>Vehicle unavailable at this time: booked {bookingLabel(vehicleBusy)}.</p>}
          {driverBusy && <p>Driver unavailable at this time: booked {bookingLabel(driverBusy)}.</p>}
        </div>
      )}
      <div className="sm:col-span-2">
        <Field label="Note to the requester" htmlFor="note" error={errors.note?.message}>
          <textarea id="note" rows={2} className={inputClass} placeholder="Optional, e.g. meet at the motor pool at 7:45" {...register('note')} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Booking…' : 'Approve and book'}</Button>
      </div>
    </form>
  )
}

const reasonSchema = z.object({ reason: z.string().trim().min(1, 'Give a reason').max(500) })

function ReasonForm({ r, path, label, submit, done, note, onClose }) {
  const { register, handleSubmit, setError, formState: { errors } } = useForm({ resolver: zodResolver(reasonSchema), defaultValues: { reason: '' } })
  const [save, error] = useRequestMutation(r, path, done, onClose, setError, ['reason'])
  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      {note && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}
      <Field label={label} htmlFor="reason" error={errors.reason?.message}>
        <textarea id="reason" rows={3} autoFocus className={inputClass} {...register('reason')} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button type="submit" variant="danger" disabled={save.isPending}>{save.isPending ? 'Saving…' : submit}</Button>
      </div>
    </form>
  )
}

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-brand">{title}</h2>
      {children}
    </section>
  )
}

function Item({ label, value, hint }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  )
}
