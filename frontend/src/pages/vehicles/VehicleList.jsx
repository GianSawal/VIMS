import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Ban, CircleCheck, LayoutList, Navigation, PackageX, Plus, Search, TriangleAlert, Wrench, X,
} from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { Button, inputBase, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatKm, STATUSES, StatusBadge, TYPES, VehiclePhoto } from './common'

// Icon + tint per status card (tints mirror the status badge tones in common.jsx).
const CARDS = {
  ALL: [LayoutList, 'bg-slate-100 text-slate-700'],
  SERVICEABLE: [CircleCheck, 'bg-green-50 text-green-700'],
  IN_USE: [Navigation, 'bg-brand-light text-brand'],
  UNDER_MAINTENANCE: [Wrench, 'bg-amber-50 text-amber-700'],
  FOR_REPAIR: [TriangleAlert, 'bg-orange-50 text-orange-700'],
  UNSERVICEABLE: [Ban, 'bg-red-50 text-danger'],
  DISPOSED: [PackageX, 'bg-slate-100 text-slate-500'],
}

const control = `${inputBase} h-9 py-0`

export default function VehicleList() {
  const can = useCan()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const offices = useAllOffices()
  // Filters live in the URL so dashboard cards can link to a filtered list (e.g. /vehicles?status=IN_USE).
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const f = Object.fromEntries(params)
  const page = Number(f.page ?? 1)
  const archived = f.archived === '1' ? { is_archived: true } : {}

  const set = useCallback((key, value) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    return next
  }, { replace: true }), [setParams])

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => set('search', search.trim()), 350)
    return () => clearTimeout(t)
  }, [search, set])

  const filters = { search: f.search, office: f.office, vehicle_type: f.vehicle_type, ...archived }
  const query = useList('/vehicles/', { page, status: f.status, ...filters })
  const summary = useList('/vehicles/summary/', filters) // every filter except status, so the cards stay comparable

  const showOffice = me?.view_all_offices || (me?.offices.length ?? 0) > 1
  const officeCode = (id) => offices.data?.results.find((o) => String(o.id) === id)?.code ?? id
  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.office && ['office', `Office: ${officeCode(f.office)}`],
    f.status && ['status', `Status: ${STATUSES.find(([v]) => v === f.status)?.[1] ?? f.status}`],
    f.vehicle_type && ['vehicle_type', `Type: ${TYPES.find(([v]) => v === f.vehicle_type)?.[1] ?? f.vehicle_type}`],
    f.archived === '1' && ['archived', 'Archived only'],
  ].filter(Boolean)

  const clearAll = () => { setSearch(''); setParams({}, { replace: true }) }
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }

  const columns = [
    { key: 'vehicle', label: 'Vehicle', render: (v) => (
      <div className="flex items-center gap-3">
        <VehiclePhoto vehicle={v} className="w-20 shrink-0 border border-slate-200" />
        <div className="min-w-0">
          <Link to={`/vehicles/${v.id}`} className="font-semibold tracking-wide text-brand hover:underline">{v.plate_number}</Link>
          <div className="truncate text-slate-700">{v.make} {v.model} {v.variant}</div>
          <div className="text-xs text-slate-500">{[v.year_model, v.vehicle_type_display].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
    ) },
    { key: 'property_number', label: 'Property No.', render: (v) => v.property_number ?? <span className="text-slate-400">—</span> },
    { key: 'office', label: 'Office', render: (v) => <span title={v.office_name}>{v.office_code}</span> },
    { key: 'current_odometer', label: 'Odometer', className: 'text-right tabular-nums', render: (v) => formatKm(v.current_odometer) },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge vehicle={v} /> },
  ]

  const toolbar = (
    <div className="border-b border-slate-200">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative w-full sm:w-80">
          <label htmlFor="vehicle-search" className="sr-only">Search vehicles</label>
          <Search size={16} className="absolute top-2.5 left-3 text-slate-400" aria-hidden="true" />
          <input id="vehicle-search" type="search" className={`${control} w-full pl-9`} placeholder="Search plate, property no., make, model…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {showOffice && (
          <select className={`${control} w-44`} aria-label="Filter by office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
            <option value="">All offices</option>
            {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
          </select>
        )}
        <select className={`${control} w-36`} aria-label="Filter by vehicle type" value={f.vehicle_type ?? ''} onChange={(e) => set('vehicle_type', e.target.value)}>
          <option value="">All types</option>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700">
          <input type="checkbox" checked={f.archived === '1'} onChange={(e) => set('archived', e.target.checked ? '1' : '')} />
          Archived only
        </label>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2">
          <span className="text-xs text-slate-500">Filtered by</span>
          {chips.map(([key, text]) => (
            <button key={key} type="button" onClick={() => remove(key)} aria-label={`Remove filter ${text}`}
              className="inline-flex items-center gap-1 rounded-md border border-brand/20 bg-white px-2 py-1 text-xs font-medium text-brand hover:bg-brand-light">
              {text} <X size={12} aria-hidden="true" />
            </button>
          ))}
          <button type="button" onClick={clearAll} className="ml-auto text-xs font-medium text-brand hover:underline">Clear all</button>
        </div>
      )}
    </div>
  )

  return (
    <div>
      <PageHeader title="Vehicles" actions={can('fleet.add_vehicle') && (
        <Button onClick={() => navigate('/vehicles/new')}><Plus size={16} /> Add vehicle</Button>
      )}>Track and manage the DOLE vehicle fleet.</PageHeader>

      <div role="group" aria-label="Filter by status" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <StatusCard type="ALL" label="All vehicles" count={summary.data?.total} loading={summary.isLoading}
          selected={!f.status} onClick={() => set('status', '')} />
        {STATUSES.map(([value, label]) => (
          <StatusCard key={value} type={value} label={label} count={summary.data?.by_status[value] ?? 0} loading={summary.isLoading}
            selected={f.status === value} onClick={() => set('status', f.status === value ? '' : value)} />
        ))}
      </div>

      <DataTable columns={columns} query={query} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
        onRowClick={(v) => navigate(`/vehicles/${v.id}`)}
        empty={chips.length ? 'No vehicles match these filters.' : 'No vehicles yet.'} />
    </div>
  )
}

function StatusCard({ type, label, count, loading, selected, onClick }) {
  const [Icon, tint] = CARDS[type]
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={`flex items-center gap-3 rounded-xl border bg-white px-3 py-3 text-left shadow-sm transition hover:shadow-md ${
        selected ? 'border-brand ring-1 ring-brand' : 'border-slate-200 hover:border-slate-300'}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        {loading
          ? <span className="block h-6 w-8 animate-pulse rounded bg-slate-200" />
          : <span className="block text-xl leading-none font-semibold text-ink tabular-nums">{count ?? 0}</span>}
        <span className="mt-1 block truncate text-xs text-slate-500">{label}</span>
      </span>
    </button>
  )
}
