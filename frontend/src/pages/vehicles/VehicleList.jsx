import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, X } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { Button, Field, inputClass, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatKm, STATUSES, StatusBadge, TYPES, VehiclePhoto } from './common'

// Left-border color per status card; mirrors the badge tones in common.jsx.
const CARD_ACCENT = {
  SERVICEABLE: 'border-l-green-600', IN_USE: 'border-l-brand', UNDER_MAINTENANCE: 'border-l-amber-500',
  FOR_REPAIR: 'border-l-orange-500', UNSERVICEABLE: 'border-l-danger', DISPOSED: 'border-l-slate-400',
}

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
  const officeName = (id) => offices.data?.results.find((o) => String(o.id) === id)?.code ?? id
  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.office && ['office', `Office: ${officeName(f.office)}`],
    f.status && ['status', `Status: ${STATUSES.find(([v]) => v === f.status)?.[1] ?? f.status}`],
    f.vehicle_type && ['vehicle_type', `Type: ${TYPES.find(([v]) => v === f.vehicle_type)?.[1] ?? f.vehicle_type}`],
    f.archived === '1' && ['archived', 'Archived only'],
  ].filter(Boolean)

  const clearAll = () => { setSearch(''); setParams({}, { replace: true }) }
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }

  const columns = [
    { key: 'photo', label: <span className="sr-only">Photo</span>, render: (v) => <VehiclePhoto vehicle={v} className="w-20" /> },
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

      <div role="group" aria-label="Filter by status" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <StatusCard label="All vehicles" count={summary.data?.total} loading={summary.isLoading}
          selected={!f.status} accent="border-l-slate-700" onClick={() => set('status', '')} />
        {STATUSES.map(([value, label]) => (
          <StatusCard key={value} label={label} count={summary.data?.by_status[value] ?? 0} loading={summary.isLoading}
            selected={f.status === value} accent={CARD_ACCENT[value]} onClick={() => set('status', f.status === value ? '' : value)} />
        ))}
      </div>

      <section aria-label="Filters" className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className={`grid gap-4 sm:grid-cols-2 ${showOffice ? 'lg:grid-cols-[2fr_1.2fr_1fr_auto]' : 'lg:grid-cols-[2fr_1fr_auto]'}`}>
          <Field label="Search" htmlFor="vehicle-search">
            <div className="relative">
              <Search size={16} className="absolute top-2.5 left-3 text-slate-400" aria-hidden="true" />
              <input id="vehicle-search" type="search" className={`${inputClass} pl-9`} placeholder="Plate, property no., engine, chassis, make, model…"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </Field>
          {showOffice && (
            <Field label="Office" htmlFor="vehicle-office">
              <select id="vehicle-office" className={inputClass} value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
                <option value="">All offices</option>
                {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Vehicle type" htmlFor="vehicle-type">
            <select id="vehicle-type" className={inputClass} value={f.vehicle_type ?? ''} onChange={(e) => set('vehicle_type', e.target.value)}>
              <option value="">All types</option>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end rounded-md border border-slate-300 px-3 py-2 text-sm">
            <input type="checkbox" checked={f.archived === '1'} onChange={(e) => set('archived', e.target.checked ? '1' : '')} />
            Archived only
          </label>
        </div>

        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">Active filters:</span>
            {chips.map(([key, text]) => (
              <button key={key} type="button" onClick={() => remove(key)} aria-label={`Remove filter ${text}`}
                className="inline-flex items-center gap-1 rounded-full bg-brand-light px-3 py-1 text-xs font-medium text-brand hover:bg-brand/20">
                {text} <X size={12} aria-hidden="true" />
              </button>
            ))}
            <button type="button" onClick={clearAll} className="ml-auto text-sm font-medium text-brand hover:underline">Clear all</button>
          </div>
        )}
      </section>

      <DataTable columns={columns} query={query} page={page} onPage={(p) => set('page', String(p))}
        empty={chips.length ? 'No vehicles match these filters.' : 'No vehicles yet.'} />
    </div>
  )
}

function StatusCard({ label, count, loading, selected, accent, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={`rounded-lg border border-l-4 bg-white p-3 text-left transition-colors hover:bg-slate-50 ${accent} ${
        selected ? 'border-brand bg-brand-light ring-2 ring-brand/30' : 'border-slate-200'}`}>
      <div className="text-xs font-medium text-slate-600">{label}</div>
      {loading
        ? <div className="mt-1 h-7 w-10 animate-pulse rounded bg-slate-200" />
        : <div className="mt-0.5 text-2xl font-bold text-ink tabular-nums">{count ?? 0}</div>}
    </button>
  )
}
