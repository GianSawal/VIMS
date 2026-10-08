import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Building2, IdCard, UserPlus, UserRound, UserX } from 'lucide-react'
import { api, applyFieldErrors, errorMessage, invalidatePrefix, useList } from '../../api'
import { useCan } from '../../auth'
import { Badge, Button, Field, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { useAllOffices } from '../admin/Offices'
import { todayISO } from '../drivers/common'
import { formatDate } from './common'

export default function AssignmentsTab({ v }) {
  const can = useCan()
  const [dialog, setDialog] = useState(null) // 'assign' | 'end'
  const query = useList(`/vehicles/${v.id}/assignments/`, { page_size: 100 })
  const current = v.current_assignment
  const canAssign = can('fleet.add_vehicleassignment') && can('fleet.change_vehicleassignment')
    && !v.is_archived && v.status !== 'DISPOSED'
  const canEnd = can('fleet.change_vehicleassignment') && !v.is_archived

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mr-auto text-sm">
          <div className="text-xs text-slate-500 uppercase">Current assignment</div>
          {current
            ? <div className="font-medium">{current.accountable_person} · {current.office}{current.driver && ` · driver ${current.driver}`}</div>
            : <div className="text-slate-500">Not currently assigned</div>}
        </div>
        {canAssign && (
          <Button onClick={() => setDialog('assign')}>
            {current ? <><ArrowRightLeft size={16} /> Reassign</> : <><UserPlus size={16} /> Assign</>}
          </Button>
        )}
        {current && canEnd && (
          <Button variant="secondary" onClick={() => setDialog('end')}><UserX size={16} /> End assignment</Button>
        )}
      </div>

      <Timeline query={query} />

      <Modal open={dialog === 'assign'} onClose={() => setDialog(null)} title={current ? `Reassign ${v.plate_number}` : `Assign ${v.plate_number}`} wide>
        {dialog === 'assign' && <AssignForm v={v} current={current} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'end'} onClose={() => setDialog(null)} title="End assignment">
        {dialog === 'end' && <EndForm v={v} current={current} onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}

// "3 days", "5 months", "2 years"; same-day handovers read "Same day".
function duration(a) {
  const end = a.end_date ? new Date(a.end_date) : new Date(todayISO())
  const days = Math.round((end - new Date(a.start_date)) / 86400000)
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (days < 1) return 'Same day'
  if (days < 60) return plural(days, 'day')
  if (days < 730) return plural(Math.round(days / 30), 'month')
  return plural(Math.round(days / 365), 'year')
}

function Timeline({ query }) {
  if (query.isLoading) {
    return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-200" />)}</div>
  }
  if (query.isError) return <p className="text-sm text-danger">{errorMessage(query.error)}</p>
  const rows = query.data?.results ?? []
  if (rows.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">This vehicle has never been assigned.</div>
  }
  return (
    <section aria-label="Assignment history">
      <h2 className="mb-3 text-sm font-semibold text-brand">Assignment history <span className="font-normal text-slate-500">· {rows.length} {rows.length === 1 ? 'record' : 'records'}</span></h2>
      <ol className="relative ml-2 border-l-2 border-slate-200">
        {rows.map((a) => (
          <li key={a.id} className="relative pb-5 pl-7 last:pb-0">
            <span aria-hidden="true" className={`absolute top-4 -left-[9px] h-4 w-4 rounded-full border-2 bg-white ${
              a.is_current ? 'border-green-600 ring-4 ring-green-100' : 'border-slate-300'}`} />
            <div className={`rounded-xl border bg-white p-4 shadow-sm ${a.is_current ? 'border-green-200' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{formatDate(a.start_date)} – {a.end_date ? formatDate(a.end_date) : 'Present'}</span>
                <span className="text-sm text-slate-500">{duration(a)}</span>
                <span className="ml-auto"><Badge tone={a.is_current ? 'green' : 'gray'} dot>{a.is_current ? 'Current' : 'Ended'}</Badge></span>
              </div>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                <Detail icon={UserRound} label="Accountable person" value={a.accountable_person} />
                <Detail icon={Building2} label="Office" value={a.office_name} />
                <Detail icon={IdCard} label="Driver"
                  value={a.driver ? <Link to={`/drivers/${a.driver}`} className="text-brand hover:underline">{a.driver_name}</Link> : (a.driver_name || '—')} />
              </dl>
              {a.remarks && <p className="mt-3 border-t border-slate-100 pt-2 text-sm text-slate-600">{a.remarks}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Detail({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="font-medium break-words">{value}</dd>
      </div>
    </div>
  )
}

function useRefresh() {
  const qc = useQueryClient()
  return () => invalidatePrefix(qc, '/vehicles/', '/drivers/')
}

const assignSchema = z.object({
  office: z.string().min(1, 'Select an office'),
  accountable_person: z.string().trim().min(1, 'Accountable person is required').max(150),
  driver: z.string(),
  start_date: z.string().min(1, 'Start date is required'),
  remarks: z.string(),
})

function AssignForm({ v, current, onClose }) {
  const toast = useToast()
  const refresh = useRefresh()
  const offices = useAllOffices()
  const drivers = useList('/drivers/', { page_size: 500, is_active: true })
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: zodResolver(assignSchema),
    defaultValues: { office: String(v.office), accountable_person: '', driver: '', start_date: todayISO(), remarks: '' },
  })

  const save = useMutation({
    mutationFn: (body) => api.post(`/vehicles/${v.id}/assignments/`, body),
    onSuccess: () => { refresh(); toast(current ? 'Vehicle reassigned.' : 'Vehicle assigned.'); onClose() },
    onError: (err) => setFormError(applyFieldErrors(err, setError, Object.keys(assignSchema.shape))),
  })

  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2"
      onSubmit={handleSubmit((x) => save.mutate({ ...x, office: Number(x.office), driver: x.driver ? Number(x.driver) : null }))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}
      {current && (
        <p className="rounded-md bg-brand-light px-3 py-2 text-sm text-brand sm:col-span-2">
          The current assignment to <strong>{current.accountable_person}</strong> will end on the start date below and stay in the history.
        </p>
      )}
      <Field label="Assigned office *" htmlFor="office" error={errors.office?.message}>
        <select id="office" className={inputClass} {...register('office')}>
          {offices.data?.results.filter((o) => o.is_active).map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      </Field>
      <Field label="Start date *" htmlFor="start_date" error={errors.start_date?.message}>
        <input id="start_date" type="date" max={todayISO()} className={inputClass} {...register('start_date')} />
      </Field>
      <Field label="Accountable person *" htmlFor="accountable_person" error={errors.accountable_person?.message}>
        <input id="accountable_person" className={inputClass} autoFocus {...register('accountable_person')} />
      </Field>
      <Field label="Driver" htmlFor="driver" error={errors.driver?.message}>
        <select id="driver" className={inputClass} {...register('driver')}>
          <option value="">No driver</option>
          {drivers.data?.results.map((d) => (
            <option key={d.id} value={d.id} disabled={d.license_status === 'EXPIRED'}>
              {d.full_name} ({d.office_code}){d.license_status === 'EXPIRED' ? ' – license expired' : d.license_status === 'EXPIRING' ? ' – license expiring' : ''}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Remarks" htmlFor="remarks" error={errors.remarks?.message}>
          <textarea id="remarks" rows={2} className={inputClass} {...register('remarks')} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : current ? 'Reassign' : 'Assign'}</Button>
      </div>
    </form>
  )
}

const endSchema = z.object({ end_date: z.string().min(1, 'End date is required') })

function EndForm({ v, current, onClose }) {
  const toast = useToast()
  const refresh = useRefresh()
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: zodResolver(endSchema), defaultValues: { end_date: todayISO() },
  })
  const end = useMutation({
    mutationFn: (body) => api.post(`/vehicles/${v.id}/end-assignment/`, body),
    onSuccess: () => { refresh(); toast('Assignment ended.'); onClose() },
    onError: (err) => setFormError(applyFieldErrors(err, setError, ['end_date'])),
  })
  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit((x) => end.mutate(x))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <p className="text-sm text-slate-600">
        {v.plate_number} will no longer be assigned to {current.accountable_person}. The record stays in the history.
      </p>
      <Field label="End date *" htmlFor="end_date" error={errors.end_date?.message}>
        <input id="end_date" type="date" max={todayISO()} className={inputClass} {...register('end_date')} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" type="submit" disabled={end.isPending}>End assignment</Button>
      </div>
    </form>
  )
}
