import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, CircleSlash, Milestone, Navigation, Plus, Route as RouteIcon } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { CardGrid, SearchBox, selectClass, StatCard, Toolbar } from '../../components/filters'
import { Button, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import DispatchForm from './DispatchForm'
import { km, shortDateTime, TRIP_STATUSES, tripStatusLabel, TripStatusBadge } from './common'

const CARDS = {
  ALL: [RouteIcon, 'bg-slate-100 text-slate-700', 'All trips'],
  DISPATCHED: [Navigation, 'bg-brand-light text-brand', 'On trip now'],
  COMPLETED: [CircleCheck, 'bg-green-50 text-green-700', 'Completed'],
  CANCELLED: [CircleSlash, 'bg-slate-100 text-slate-500', 'Cancelled'],
}
const card = (t) => ({ icon: CARDS[t][0], tint: CARDS[t][1], label: CARDS[t][2] })

/** Trip table columns, shared with the vehicle Trips tab (`withVehicle` = false there). */
export function tripColumns({ withVehicle = true } = {}) {
  return [
    { key: 'ticket', label: 'Trip ticket', render: (t) => (
      <div className="min-w-0">
        <Link to={`/trips/${t.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] font-semibold text-brand hover:underline">{t.ticket_number}</Link>
        <div className="max-w-56 truncate text-xs text-slate-500" title={t.purpose}>{t.purpose}</div>
      </div>
    ) },
    ...(withVehicle ? [{ key: 'vehicle', label: 'Vehicle', render: (t) => (
      <div>
        <div className="font-medium">{t.plate_number}</div>
        <div className="text-xs text-slate-500">{t.vehicle_label}</div>
      </div>
    ) }] : []),
    { key: 'driver', label: 'Driver', render: (t) => t.driver_name },
    { key: 'route', label: 'Route', render: (t) => (
      <div className="max-w-64 text-sm">
        <div className="truncate" title={t.origin}>{t.origin}</div>
        <div className="truncate text-slate-500" title={t.destination}>→ {t.destination}</div>
      </div>
    ) },
    { key: 'time', label: 'Departed / returned', render: (t) => (
      <div className="text-sm whitespace-nowrap">
        <div>{shortDateTime(t.departed_at)}</div>
        <div className="text-slate-500">{t.returned_at ? shortDateTime(t.returned_at) : t.status === 'DISPATCHED' ? 'Not yet returned' : '—'}</div>
      </div>
    ) },
    { key: 'distance', label: 'Distance', className: 'text-right tabular-nums whitespace-nowrap', render: (t) => km(t.distance_km) },
    { key: 'status', label: 'Status', render: (t) => <TripStatusBadge status={t.status} /> },
  ]
}

export default function TripList() {
  const can = useCan()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const offices = useAllOffices()
  const [dispatching, setDispatching] = useState(false)
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const f = Object.fromEntries(params)
  const page = Number(f.page ?? 1)

  const set = useCallback((key, value) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    return next
  }, { replace: true }), [setParams])

  useEffect(() => {
    const t = setTimeout(() => set('search', search.trim()), 350)
    return () => clearTimeout(t)
  }, [search, set])

  const filters = { search: f.search, office: f.office, date_from: f.date_from, date_to: f.date_to }
  const query = useList('/trips/', { page, status: f.status, ...filters })
  const summary = useList('/trips/summary/', filters)

  const showOffice = me?.view_all_offices || (me?.offices.length ?? 0) > 1
  const officeCode = (id) => offices.data?.results.find((o) => String(o.id) === id)?.code ?? id
  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.office && ['office', `Office: ${officeCode(f.office)}`],
    f.status && ['status', `Status: ${tripStatusLabel[f.status]}`],
    f.date_from && ['date_from', `From ${f.date_from}`],
    f.date_to && ['date_to', `To ${f.date_to}`],
  ].filter(Boolean)
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }
  const clearAll = () => { setSearch(''); setParams({}, { replace: true }) }

  const toolbar = (
    <Toolbar chips={chips} onRemove={remove} onClear={clearAll}>
      <SearchBox id="trip-search" label="Search trips" placeholder="Search ticket, plate, driver, destination…" value={search} onChange={setSearch} />
      {showOffice && (
        <select className={`${selectClass} w-44`} aria-label="Filter by vehicle office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
          <option value="">All offices</option>
          {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-600">
        From <input type="date" className={`${selectClass} w-40`} value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        To <input type="date" className={`${selectClass} w-40`} value={f.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} />
      </label>
    </Toolbar>
  )

  return (
    <div>
      <PageHeader title="Trips" actions={can('operations.add_trip') && (
        <Button onClick={() => setDispatching(true)}><Plus size={16} /> Dispatch trip</Button>
      )}>Trip tickets, dispatches and returns.</PageHeader>

      <CardGrid label="Filter by trip status">
        <StatCard {...card('ALL')} count={summary.data?.total} loading={summary.isLoading} selected={!f.status} onClick={() => set('status', '')} />
        {TRIP_STATUSES.map(([value]) => (
          <StatCard key={value} {...card(value)} count={summary.data?.by_status[value] ?? 0} loading={summary.isLoading}
            selected={f.status === value} onClick={() => set('status', f.status === value ? '' : value)} />
        ))}
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Milestone size={18} aria-hidden="true" /></span>
          <span>
            <span className="block text-xl leading-none font-semibold tabular-nums">{summary.isLoading ? '…' : km(summary.data?.distance_km ?? 0)}</span>
            <span className="mt-1 block text-xs text-slate-500">Distance (completed)</span>
          </span>
        </div>
      </CardGrid>

      <DataTable columns={tripColumns()} query={query} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
        onRowClick={(t) => navigate(`/trips/${t.id}`)}
        empty={chips.length ? 'No trips match these filters.' : 'No trips yet.'} />

      <Modal open={dispatching} onClose={() => setDispatching(false)} title="Dispatch trip" wide>
        {dispatching && <DispatchForm onClose={() => setDispatching(false)} onSaved={(t) => navigate(`/trips/${t.id}`)} />}
      </Modal>
    </div>
  )
}
