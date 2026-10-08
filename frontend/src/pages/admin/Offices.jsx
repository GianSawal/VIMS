import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search } from 'lucide-react'
import { api, applyFieldErrors, useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { Badge, Button, Field, inputBase, inputClass, Modal, PageHeader } from '../../components/ui'
import { useToast } from '../../components/toast'

export const OFFICE_TYPES = [
  ['REGIONAL', 'Regional Office'],
  ['PROVINCIAL', 'Provincial Office'],
  ['FIELD', 'Field Office'],
  ['SATELLITE', 'Satellite Office'],
]
const typeLabel = Object.fromEntries(OFFICE_TYPES)

export function useAllOffices() {
  return useList('/offices/', { page_size: 500 })
}

export default function Offices() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [editing, setEditing] = useState(null) // null | {} (new) | office
  const query = useList('/offices/', { page, search, office_type: type })
  const canEdit = can('accounts.change_office')

  const columns = [
    { key: 'code', label: 'Code', className: 'font-medium' },
    { key: 'name', label: 'Name' },
    { key: 'office_type', label: 'Type', render: (o) => typeLabel[o.office_type] },
    { key: 'parent_name', label: 'Parent', render: (o) => o.parent_name ?? '—' },
    { key: 'is_active', label: 'Status', render: (o) => <Badge tone={o.is_active ? 'green' : 'gray'}>{o.is_active ? 'Active' : 'Inactive'}</Badge> },
    ...(canEdit ? [{
      key: 'actions', label: <span className="sr-only">Actions</span>,
      render: (o) => <Button variant="ghost" onClick={() => setEditing(o)} aria-label={`Edit ${o.name}`}><Pencil size={16} /></Button>,
    }] : []),
  ]

  return (
    <div>
      <PageHeader title="Offices" actions={can('accounts.add_office') && (
        <Button onClick={() => setEditing({})}><Plus size={16} /> Add office</Button>
      )}>Regional, provincial and field offices.</PageHeader>

      <div className="mb-3 flex flex-wrap gap-2">
        <label className="relative">
          <span className="sr-only">Search offices</span>
          <Search size={16} className="absolute top-2.5 left-3 text-slate-400" aria-hidden="true" />
          <input className={`${inputBase} w-64 pl-9`} placeholder="Search code or name" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </label>
        <select className={`${inputBase} w-48`} value={type} aria-label="Filter by type"
          onChange={(e) => { setType(e.target.value); setPage(1) }}>
          <option value="">All types</option>
          {OFFICE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <DataTable columns={columns} query={query} page={page} onPage={setPage} empty="No offices yet." />
      <OfficeForm office={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

const schema = z.object({
  code: z.string().trim().min(1, 'Required').max(20),
  name: z.string().trim().min(1, 'Required').max(150),
  office_type: z.string().min(1, 'Required'),
  parent: z.string(),
  is_active: z.boolean(),
})

function OfficeForm({ office, onClose }) {
  const isNew = office && !office.id
  return (
    <Modal open={!!office} onClose={onClose} title={isNew ? 'Add office' : `Edit ${office?.code}`}>
      {office && <OfficeFormBody key={office.id ?? 'new'} office={office} onClose={onClose} />}
    </Modal>
  )
}

function OfficeFormBody({ office, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const offices = useAllOffices()
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      code: office.code ?? '', name: office.name ?? '', office_type: office.office_type ?? '',
      parent: office.parent ? String(office.parent) : '', is_active: office.is_active ?? true,
    },
  })
  const save = useMutation({
    mutationFn: (body) => office.id ? api.patch(`/offices/${office.id}/`, body) : api.post('/offices/', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/offices/'] })
      toast(office.id ? 'Office updated.' : 'Office added.')
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, ['code', 'name', 'office_type', 'parent'])),
  })

  return (
    <form noValidate className="space-y-4"
      onSubmit={handleSubmit((v) => save.mutate({ ...v, parent: v.parent ? Number(v.parent) : null }))}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <Field label="Code" htmlFor="code" error={errors.code?.message}>
        <input id="code" className={inputClass} {...register('code')} />
      </Field>
      <Field label="Name" htmlFor="name" error={errors.name?.message}>
        <input id="name" className={inputClass} {...register('name')} />
      </Field>
      <Field label="Type" htmlFor="office_type" error={errors.office_type?.message}>
        <select id="office_type" className={inputClass} {...register('office_type')}>
          <option value="">Select…</option>
          {OFFICE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Parent office" htmlFor="parent" error={errors.parent?.message}>
        <select id="parent" className={inputClass} {...register('parent')}>
          <option value="">None</option>
          {offices.data?.results.filter((o) => o.id !== office.id).map((o) => (
            <option key={o.id} value={o.id}>{o.code} - {o.name}</option>
          ))}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register('is_active')} /> Active
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )
}
