import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Landmark, MapPin, Network, Pencil, Plus, Store } from 'lucide-react'
import { api, applyFieldErrors, useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { CardGrid, SearchBox, selectClass, StatCard, Toolbar } from '../../components/filters'
import { Badge, Button, Field, inputClass, Modal, PageHeader } from '../../components/ui'
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

const TYPE_CARDS = {
  ALL: [Network, 'bg-slate-100 text-slate-700', 'All offices'],
  REGIONAL: [Landmark, 'bg-brand-light text-brand', 'Regional'],
  PROVINCIAL: [Building2, 'bg-sky-50 text-sky-700', 'Provincial'],
  FIELD: [MapPin, 'bg-green-50 text-green-700', 'Field'],
  SATELLITE: [Store, 'bg-amber-50 text-amber-700', 'Satellite'],
}
const typeCard = (t) => ({ icon: TYPE_CARDS[t][0], tint: TYPE_CARDS[t][1], label: TYPE_CARDS[t][2] })

export default function Offices() {
  const can = useCan()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [active, setActive] = useState('')
  const [editing, setEditing] = useState(null) // null | {} (new) | office
  const query = useList('/offices/', { page, search, office_type: type, is_active: active })
  const everything = useAllOffices() // unfiltered, for the type cards (office lists are small)
  const canEdit = can('accounts.change_office')
  const count = (t) => everything.data?.results.filter((o) => !t || o.office_type === t).length

  const filter = (setter) => (value) => { setter(value); setPage(1) }
  const chips = [
    search && ['search', `Search: “${search}”`],
    type && ['type', `Type: ${typeLabel[type]}`],
    active && ['active', active === 'true' ? 'Active only' : 'Inactive only'],
  ].filter(Boolean)
  const clear = { search: () => setSearch(''), type: () => setType(''), active: () => setActive('') }
  const clearAll = () => { setSearch(''); setType(''); setActive(''); setPage(1) }

  const columns = [
    { key: 'office', label: 'Office', render: (o) => (
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-brand-light px-2 py-1 font-mono text-xs font-semibold text-brand">{o.code}</span>
        <span className="font-medium">{o.name}</span>
      </div>
    ) },
    { key: 'office_type', label: 'Type', render: (o) => typeLabel[o.office_type] },
    { key: 'parent_name', label: 'Reports to', render: (o) => o.parent_name ?? <span className="text-slate-400">—</span> },
    { key: 'is_active', label: 'Status', render: (o) => <Badge tone={o.is_active ? 'green' : 'gray'} dot>{o.is_active ? 'Active' : 'Inactive'}</Badge> },
    ...(canEdit ? [{
      key: 'actions', label: <span className="sr-only">Actions</span>, className: 'text-right',
      render: (o) => <Button variant="ghost" onClick={() => setEditing(o)} aria-label={`Edit ${o.name}`} title="Edit"><Pencil size={16} /></Button>,
    }] : []),
  ]

  const toolbar = (
    <Toolbar chips={chips} onRemove={(k) => { clear[k](); setPage(1) }} onClear={clearAll}>
      <SearchBox id="office-search" label="Search offices" placeholder="Search code or name…" value={search} onChange={filter(setSearch)} />
      <select className={`${selectClass} w-44`} aria-label="Filter by type" value={type} onChange={(e) => filter(setType)(e.target.value)}>
        <option value="">All types</option>
        {OFFICE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select className={`${selectClass} w-36`} aria-label="Filter by status" value={active} onChange={(e) => filter(setActive)(e.target.value)}>
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
    </Toolbar>
  )

  return (
    <div>
      <PageHeader title="Offices" actions={can('accounts.add_office') && (
        <Button onClick={() => setEditing({})}><Plus size={16} /> Add office</Button>
      )}>Regional, provincial, field and satellite offices.</PageHeader>

      <CardGrid label="Filter by office type">
        <StatCard {...typeCard('ALL')} count={count()} loading={everything.isLoading} selected={!type} onClick={() => filter(setType)('')} />
        {OFFICE_TYPES.map(([value]) => (
          <StatCard key={value} {...typeCard(value)} count={count(value)} loading={everything.isLoading}
            selected={type === value} onClick={() => filter(setType)(type === value ? '' : value)} />
        ))}
      </CardGrid>

      <DataTable columns={columns} query={query} page={page} onPage={setPage} toolbar={toolbar}
        empty={chips.length ? 'No offices match these filters.' : 'No offices yet.'} />
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
