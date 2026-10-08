import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, UserPlus, UserX } from 'lucide-react'
import { api, applyFieldErrors, invalidatePrefix, useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { Badge, Button, Field, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { useAllOffices } from '../admin/Offices'
import { todayISO } from '../drivers/common'
import { formatDate } from './common'

export default function AssignmentsTab({ v }) {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null) // 'assign' | 'end'
  const query = useList(`/vehicles/${v.id}/assignments/`, { page })
  const current = v.current_assignment
  const canAssign = can('fleet.add_vehicleassignment') && can('fleet.change_vehicleassignment')
    && !v.is_archived && v.status !== 'DISPOSED'
  const canEnd = can('fleet.change_vehicleassignment') && !v.is_archived

  const columns = [
    { key: 'period', label: 'Period', render: (a) => `${formatDate(a.start_date)} – ${a.end_date ? formatDate(a.end_date) : 'present'}` },
    { key: 'office', label: 'Office', render: (a) => a.office_name },
    { key: 'accountable_person', label: 'Accountable person' },
    { key: 'driver', label: 'Driver', render: (a) => a.driver
      ? <Link to={`/drivers/${a.driver}`} className="text-brand hover:underline">{a.driver_name}</Link>
      : (a.driver_name || '—') },
    { key: 'remarks', label: 'Remarks', render: (a) => a.remarks || '—' },
    { key: 'status', label: 'Status', render: (a) => <Badge tone={a.is_current ? 'green' : 'gray'}>{a.is_current ? 'Current' : 'Ended'}</Badge> },
  ]

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

      <DataTable columns={columns} query={query} page={page} onPage={setPage} empty="This vehicle has never been assigned." />

      <Modal open={dialog === 'assign'} onClose={() => setDialog(null)} title={current ? `Reassign ${v.plate_number}` : `Assign ${v.plate_number}`} wide>
        {dialog === 'assign' && <AssignForm v={v} current={current} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'end'} onClose={() => setDialog(null)} title="End assignment">
        {dialog === 'end' && <EndForm v={v} current={current} onClose={() => setDialog(null)} />}
      </Modal>
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
