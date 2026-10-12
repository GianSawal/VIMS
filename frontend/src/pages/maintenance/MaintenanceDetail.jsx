import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Check, CircleCheck, Gauge, Hammer, Pencil, ScanSearch, Store, Wrench, X, XCircle } from 'lucide-react'
import { api, applyFieldErrors, errorMessage, invalidatePrefix } from '../../api'
import { useCan } from '../../auth'
import Attachments from '../../components/Attachments'
import { Button, Field, formatDateTime, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { NotFound } from '../Errors'
import { todayISO } from '../drivers/common'
import { formatDate, formatKm, formatPeso, VehiclePhoto } from '../vehicles/common'
import { CategoryChips, FLOW, MaintenanceStatusBadge } from './common'
import MaintenanceForm from './MaintenanceForm'

const NEXT = { SCHEDULED: ['FOR_INSPECTION', 'Start inspection', ScanSearch], FOR_INSPECTION: ['IN_PROGRESS', 'Start work', Hammer], IN_PROGRESS: ['COMPLETED', 'Complete job', CircleCheck] }

export default function MaintenanceDetail() {
  const { id } = useParams()
  const can = useCan()
  const [dialog, setDialog] = useState(null) // 'edit' | 'complete' | 'cancel'
  const q = useQuery({ queryKey: ['/maintenance/', id], queryFn: () => api.get(`/maintenance/${id}/`).then((r) => r.data) })
  const r = q.data

  if (q.isLoading) return <div className="animate-pulse space-y-3"><div className="h-8 w-56 rounded bg-slate-200" /><div className="h-56 rounded-xl bg-slate-200" /></div>
  if (q.error?.response?.status === 404) return <NotFound />
  if (q.isError) return <div className="text-danger">{errorMessage(q.error)}</div>

  const canChange = can('maintenance.change_maintenancerecord')
  const open = ['SCHEDULED', 'FOR_INSPECTION', 'IN_PROGRESS'].includes(r.status)
  const next = NEXT[r.status]

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/maintenance" className="hover:underline">Maintenance</Link> / <span aria-current="page">{r.plate_number} · {formatDate(r.date)}</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-ink">{r.plate_number}</h1>
            <MaintenanceStatusBadge status={r.status} />
            {r.reference_number && <span className="rounded-md border border-slate-300 px-2 py-0.5 font-mono text-xs font-semibold">PR {r.reference_number}</span>}
          </div>
          <div className="mt-2"><CategoryChips names={r.category_names} /></div>
        </div>
        {canChange && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil size={16} /> {open ? 'Edit' : 'Edit remarks'}</Button>}
        {canChange && open && <Button variant="secondary" className="text-danger" onClick={() => setDialog('cancel')}><XCircle size={16} /> Cancel</Button>}
        {canChange && next && <NextButton r={r} next={next} onComplete={() => setDialog('complete')} />}
      </div>

      <Progress r={r} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Work">
            <p className="whitespace-pre-line">{r.description}</p>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              <Item icon={Store} label="Supplier" value={r.service_provider || '—'} />
              <Item icon={Gauge} label="Odometer" value={r.odometer != null ? formatKm(r.odometer) : '—'} />
              <Item icon={Wrench} label="Dates" value={[r.started_on && `Started ${formatDate(r.started_on)}`, r.completed_on && `Done ${formatDate(r.completed_on)}`].filter(Boolean).join(' · ') || `Booked ${formatDate(r.date)}`} />
            </dl>
          </Card>

          <Card title="Cost">
            <div className="grid gap-3 sm:grid-cols-3">
              <Money label="Labor" value={r.labor_cost} />
              <Money label="Parts" value={r.parts_cost} />
              <Money label="Total" value={r.total_cost} strong />
            </div>
            {open && <p className="mt-3 text-xs text-slate-500">Final costs can be entered when the job is completed.</p>}
          </Card>

          {(r.next_service_date || r.next_service_odometer != null) && (
            <Card title="Next service">
              <p className="text-lg font-semibold">
                {[r.next_service_date && formatDate(r.next_service_date), r.next_service_odometer != null && formatKm(r.next_service_odometer)].filter(Boolean).join(' or ')}
              </p>
              <p className="text-xs text-slate-500">Whichever comes first. {r.status === 'COMPLETED' ? 'Suggested from the preventive schedule unless typed.' : ''}</p>
            </Card>
          )}

          <Attachments basePath={`/maintenance/${r.id}`} canChange={canChange} title="PR, job order and receipts" />
        </div>

        <div className="space-y-4">
          <Card title="Vehicle">
            <Link to={`/vehicles/${r.vehicle}?tab=maintenance`} className="block" aria-label={`Open vehicle ${r.plate_number}`}>
              <VehiclePhoto vehicle={{ photo_url: r.vehicle_photo_url, plate_number: r.plate_number, make: '', model: r.vehicle_label }} className="border border-slate-200" />
            </Link>
            <p className="mt-3 font-semibold">{r.plate_number}</p>
            <p className="text-sm text-slate-500">{r.vehicle_label} · {r.office_code}</p>
          </Card>
          {r.remarks && <Card title="Remarks"><p className="text-sm whitespace-pre-line">{r.remarks}</p></Card>}
          <p className="text-xs text-slate-400">Created {formatDateTime(r.created_at)} · Updated {formatDateTime(r.updated_at)}</p>
        </div>
      </div>

      <Modal open={dialog === 'edit'} onClose={() => setDialog(null)} title="Edit maintenance record" wide>
        {dialog === 'edit' && <MaintenanceForm record={r} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'complete'} onClose={() => setDialog(null)} title="Complete maintenance job">
        {dialog === 'complete' && <CompleteForm record={r} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'cancel'} onClose={() => setDialog(null)} title="Cancel maintenance record">
        {dialog === 'cancel' && <CancelForm record={r} onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}

/** Status mutation shared by the advance button and the dialogs. */
function useStatusChange(record, message, onDone) {
  const qc = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState('')
  const m = useMutation({
    mutationFn: (body) => api.post(`/maintenance/${record.id}/status/`, body),
    onSuccess: ({ data }) => {
      qc.setQueryData(['/maintenance/', String(record.id)], data)
      invalidatePrefix(qc, '/maintenance', '/vehicles/')
      toast(message)
      onDone?.()
    },
    onError: (err) => { setError(errorMessage(err)); onDone?.(err) },
  })
  return [m, error, setError]
}

function NextButton({ r, next: [status, label, Icon], onComplete }) {
  const toast = useToast()
  const [m] = useStatusChange(r, status === 'IN_PROGRESS' ? 'Work started. Vehicle is Under Maintenance.' : 'Status updated.', (err) => err && toast(errorMessage(err), 'error'))
  if (status === 'COMPLETED') return <Button onClick={onComplete}><Icon size={16} /> {label}</Button>
  return <Button onClick={() => m.mutate({ status })} disabled={m.isPending}><Icon size={16} /> {label}</Button>
}

const completeSchema = z.object({
  completed_on: z.string().min(1, 'Completion date is required'),
  odometer: z.string().trim().refine((v) => v === '' || /^\d+$/.test(v.replace(/[,\s]/g, '')), 'Enter whole km'),
  labor_cost: z.string().trim().refine((v) => /^\d*(\.\d{1,2})?$/.test(v.replace(/,/g, '')), 'Enter an amount like 1500.00'),
  parts_cost: z.string().trim().refine((v) => /^\d*(\.\d{1,2})?$/.test(v.replace(/,/g, '')), 'Enter an amount like 3200.00'),
  next_service_date: z.string(),
  next_service_odometer: z.string().trim().refine((v) => v === '' || /^\d+$/.test(v.replace(/[,\s]/g, '')), 'Enter whole km'),
})

function CompleteForm({ record, onClose }) {
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(completeSchema),
    defaultValues: {
      completed_on: todayISO(), odometer: record.odometer ?? '', labor_cost: String(Number(record.labor_cost) || ''), parts_cost: String(Number(record.parts_cost) || ''),
      next_service_date: record.next_service_date ?? '', next_service_odometer: record.next_service_odometer ?? '',
    },
  })
  const [m, error, setFormError] = useStatusChange(record, 'Job completed. Preventive schedules updated.', (err) => {
    if (!err) return onClose()
    setFormError(applyFieldErrors(err, setError, Object.keys(completeSchema.shape)))
  })
  const n = (v) => Number(String(v).replace(/,/g, '')) || 0
  const total = n(watch('labor_cost')) + n(watch('parts_cost'))
  const odo = (v) => (v ? Number(String(v).replace(/[,\s]/g, '')) : undefined)

  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => m.mutate({
      status: 'COMPLETED', completed_on: v.completed_on, odometer: odo(v.odometer), labor_cost: String(n(v.labor_cost)), parts_cost: String(n(v.parts_cost)),
      next_service_date: v.next_service_date || null, next_service_odometer: odo(v.next_service_odometer) ?? null,
    }))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}
      <Field label="Completed on *" htmlFor="completed_on" error={errors.completed_on?.message}>
        <input id="completed_on" type="date" max={todayISO()} className={inputClass} {...register('completed_on')} />
      </Field>
      <Field label="Odometer at completion (km)" htmlFor="odometer" error={errors.odometer?.message} hint="Also sets the preventive schedule's last-service reading.">
        <input id="odometer" inputMode="numeric" className={inputClass} {...register('odometer')} />
      </Field>
      <Field label="Final labor cost (₱)" htmlFor="labor_cost" error={errors.labor_cost?.message}>
        <input id="labor_cost" inputMode="decimal" className={inputClass} {...register('labor_cost')} />
      </Field>
      <Field label="Final parts cost (₱)" htmlFor="parts_cost" error={errors.parts_cost?.message} hint={`Total: ${formatPeso(total)}`}>
        <input id="parts_cost" inputMode="decimal" className={inputClass} {...register('parts_cost')} />
      </Field>
      <Field label="Next service date" htmlFor="next_service_date" error={errors.next_service_date?.message} hint="Blank = suggested from the vehicle's schedule.">
        <input id="next_service_date" type="date" className={inputClass} {...register('next_service_date')} />
      </Field>
      <Field label="Next service odometer (km)" htmlFor="next_service_odometer" error={errors.next_service_odometer?.message}>
        <input id="next_service_odometer" inputMode="numeric" className={inputClass} {...register('next_service_odometer')} />
      </Field>
      <p className="rounded-md bg-brand-light px-3 py-2 text-sm text-brand sm:col-span-2">
        Completing resets the preventive schedules of this job&apos;s categories and returns the vehicle to Serviceable.
      </p>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Complete job'}</Button>
      </div>
    </form>
  )
}

function CancelForm({ record, onClose }) {
  const [m, error] = useStatusChange(record, 'Maintenance cancelled.', (err) => { if (!err) onClose() })
  return (
    <div className="space-y-4">
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <p className="text-sm text-slate-600">This record stays on file as cancelled. If the vehicle is in the workshop for it, the vehicle returns to Serviceable.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button variant="danger" onClick={() => m.mutate({ status: 'CANCELLED' })} disabled={m.isPending}>Cancel record</Button>
      </div>
    </div>
  )
}

/** Scheduled -> Inspection -> In progress -> Completed (or Cancelled). Words and icons carry the meaning, not color. */
function Progress({ r }) {
  const cancelled = r.status === 'CANCELLED'
  const at = FLOW.findIndex(([k]) => k === r.status)
  return (
    <ol aria-label="Maintenance progress" className="mb-4 grid grid-cols-4 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      {FLOW.map(([key, label], i) => {
        const done = (!cancelled && i < at) || r.status === 'COMPLETED'
        const current = !cancelled && i === at && r.status !== 'COMPLETED'
        const last = i === FLOW.length - 1
        const cancelHere = cancelled && last
        return (
          <li key={key} aria-current={current ? 'step' : undefined} className="relative flex flex-col items-center text-center">
            {i > 0 && <span aria-hidden="true" className={`absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2 ${done || current ? 'bg-brand' : 'bg-slate-200'}`} />}
            <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
              cancelHere ? 'bg-slate-500 text-white' : done ? 'bg-brand text-white' : current ? 'bg-white text-brand ring-2 ring-brand' : 'bg-white text-slate-400 ring-2 ring-slate-200'}`}>
              {cancelHere ? <X size={16} aria-hidden="true" /> : done ? <Check size={16} aria-hidden="true" /> : i + 1}
            </span>
            <span className="mt-2 text-sm font-semibold">{cancelHere ? 'Cancelled' : label}</span>
            <span className="text-xs text-slate-500">
              {key === 'IN_PROGRESS' && r.started_on ? formatDate(r.started_on) : key === 'COMPLETED' && r.completed_on ? formatDate(r.completed_on) : key === 'SCHEDULED' ? formatDate(r.date) : ''}
            </span>
          </li>
        )
      })}
    </ol>
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

function Item({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="font-medium">{value}</dd></div>
    </div>
  )
}

function Money({ label, value, strong }) {
  return (
    <div className={`rounded-lg px-4 py-3 ${strong ? 'bg-brand-light' : 'bg-slate-50'}`}>
      <div className="flex items-center gap-1.5 text-xs text-slate-500"><Banknote size={14} aria-hidden="true" />{label}</div>
      <div className={`mt-1 tabular-nums ${strong ? 'text-2xl font-bold text-brand' : 'text-xl font-semibold'}`}>{formatPeso(value)}</div>
    </div>
  )
}
