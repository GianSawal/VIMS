import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, CalendarClock, CircleCheck, Gauge, MapPin, Pencil, UserRound, Users, XCircle } from 'lucide-react'
import { api, applyFieldErrors, errorMessage, invalidatePrefix } from '../../api'
import { useCan } from '../../auth'
import Attachments from '../../components/Attachments'
import { Button, Field, formatDateTime, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { NotFound } from '../Errors'
import { useAllOffices } from '../admin/Offices'
import { fromLocalInput, km, toLocalInput, tripDuration, TripStatusBadge } from './common'

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
        {canChange && open && <Button variant="secondary" className="text-danger" onClick={() => setDialog('cancel')}><XCircle size={16} /> Cancel trip</Button>}
        {canChange && open && <Button onClick={() => setDialog('complete')}><CircleCheck size={16} /> Record return</Button>}
      </div>

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
              <Metric icon={CalendarClock} label="Departed" value={formatDateTime(t.departed_at)} />
              <Metric icon={CalendarClock} label="Returned" value={t.returned_at ? formatDateTime(t.returned_at) : open ? 'Not yet returned' : '—'} />
              <Metric icon={CalendarClock} label={open ? 'Out for' : 'Duration'}
                value={t.status === 'CANCELLED' ? '—' : tripDuration(t.departed_at, t.returned_at)} />
              <Metric icon={Gauge} label="Odometer out" value={km(t.odometer_start)} />
              <Metric icon={Gauge} label="Odometer in" value={km(t.odometer_end)} />
              <Metric icon={Gauge} label="Distance" value={km(t.distance_km)} strong />
            </div>
          </Card>

          <Attachments basePath={`/trips/${t.id}`} canChange={canChange} title="Trip ticket scans and attachments" />
        </div>

        <div className="space-y-4">
          <Card title="Vehicle and driver">
            <dl className="space-y-3 text-sm">
              <Item label="Vehicle" value={<Link to={`/vehicles/${t.vehicle}`} className="font-medium text-brand hover:underline">{t.plate_number}</Link>} hint={`${t.vehicle_label} · ${t.office_code}`} />
              <Item label="Driver" icon={UserRound} value={<Link to={`/drivers/${t.driver}`} className="font-medium text-brand hover:underline">{t.driver_name}</Link>} />
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
  odometer_end: z.string().trim().refine((v) => /^\d+$/.test(v), 'Enter the odometer in whole km'),
  remarks: z.string(),
})

function CompleteForm({ trip, onClose }) {
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(completeSchema),
    defaultValues: { returned_at: toLocalInput(), odometer_end: '', remarks: trip.remarks ?? '' },
  })
  const [save, error] = useTripMutation(trip, 'complete', 'Trip completed. Vehicle odometer updated.', onClose, setError, ['returned_at', 'odometer_end', 'remarks'])
  const end = Number(watch('odometer_end'))
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
