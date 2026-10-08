import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { Button, inputClass, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatKm, STATUSES, StatusBadge, TYPES, VehiclePhoto } from './common'

export default function VehicleList() {
  const can = useCan()
  const { data: me } = useMe()
  const navigate = useNavigate()
  // Filters live in the URL so dashboard cards can link to a filtered list (e.g. /vehicles?status=IN_USE).
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const offices = useAllOffices()
  const f = Object.fromEntries(params)
  const page = Number(f.page ?? 1)
  const query = useList('/vehicles/', {
    page, search: f.search, office: f.office, status: f.status, vehicle_type: f.vehicle_type,
    ...(f.archived === '1' ? { is_archived: true } : {}),
  })

  const set = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  const columns = [
    { key: 'photo', label: <span className="sr-only">Photo</span>, render: (v) => <VehiclePhoto vehicle={v} className="w-16" /> },
    { key: 'plate_number', label: 'Plate', render: (v) => (
      <Link to={`/vehicles/${v.id}`} className="font-semibold text-brand hover:underline">{v.plate_number}</Link>
    ) },
    { key: 'vehicle', label: 'Vehicle', render: (v) => (
      <div>
        <div>{v.make} {v.model} {v.variant}</div>
        <div className="text-xs text-slate-500">{[v.year_model, v.vehicle_type_display].filter(Boolean).join(' · ')}</div>
      </div>
    ) },
    { key: 'property_number', label: 'Property No.', render: (v) => v.property_number ?? '—' },
    { key: 'office', label: 'Office', render: (v) => v.office_code },
    { key: 'current_odometer', label: 'Odometer', className: 'text-right tabular-nums', render: (v) => formatKm(v.current_odometer) },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge vehicle={v} /> },
  ]

  return (
    <div>
      <PageHeader title="Vehicles" actions={can('fleet.add_vehicle') && (
        <Button onClick={() => navigate('/vehicles/new')}><Plus size={16} /> Add vehicle</Button>
      )}>Vehicle master list</PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); set('search', search.trim()) }}>
          <label htmlFor="vehicle-search" className="sr-only">Search vehicles</label>
          <Search size={16} className="absolute top-2.5 left-3 text-slate-400" aria-hidden="true" />
          <input id="vehicle-search" className={`${inputClass} w-72 pl-9`} placeholder="Plate, property, engine, chassis, make…"
            value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => set('search', search.trim())} />
        </form>
        {(me?.view_all_offices || (me?.offices.length ?? 0) > 1) && (
          <select className={`${inputClass} w-48`} aria-label="Filter by office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
            <option value="">All offices</option>
            {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
          </select>
        )}
        <select className={`${inputClass} w-44`} aria-label="Filter by status" value={f.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className={`${inputClass} w-40`} aria-label="Filter by type" value={f.vehicle_type ?? ''} onChange={(e) => set('vehicle_type', e.target.value)}>
          <option value="">All types</option>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={f.archived === '1'} onChange={(e) => set('archived', e.target.checked ? '1' : '')} />
          Show archived only
        </label>
      </div>

      <DataTable columns={columns} query={query} page={page} onPage={(p) => set('page', String(p))}
        empty={f.search || f.status || f.office || f.vehicle_type ? 'No vehicles match these filters.' : 'No vehicles yet.'} />
    </div>
  )
}
