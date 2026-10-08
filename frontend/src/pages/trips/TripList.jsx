import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, CircleSlash, Clock, Milestone, Navigation, Plus, Route as RouteIcon } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { CardGrid, SearchBox, selectClass, StatCard, Toolbar } from '../../components/filters'
import { Button, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import DispatchForm from './DispatchForm'
import { CompleteForm } from './TripDetail'
import { km, shortDateTime, TRIP_STATUSES, tripDuration, tripStatusLabel, TripStatusBadge } from './common'

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
        <div className="text-slate-500">{t.returned_at ? shortDateTime(t.returned_at) : t.status === 'DISPATCHED' ? `Out ${tripDuration(t.departed_at)}` : '—'}</div>
      </div>
    ) },
    { key: 'distance', label: 'Distance', className: 'text-right tabular-nums whitespace-nowrap', render: (t) => km(t.distance_km) },
    { key: 'status', label: 'Status', render: (t) => <TripStatusBadge status={t.status} /> },
  ]
}

// [label, from, to] as local YYYY-MM-DD, computed once per page visit.
function datePresets() {
  const iso = (d) => d.toLocaleDateString('en-CA')
  const now = new Date()
  const daysAgo = (n) => iso(new Date(now.getTime() - n * 864e5))
  const today = iso(now)
  return [['Today', today, today], ['Last 7 days', daysAgo(6), today], ['Last 30 days', daysAgo(29), today],
    ['This month', iso(new Date(now.getFullYear(), now.getMonth(), 1)), today]]
}

const LONG_TRIP_HOURS = 12 // flag trips out longer than this (still shown in text, not by color alone)

/** Live board of vehicles currently out, so returns can be recorded without hunting through the table. */
function OpenTrips({ canChange, onViewAll }) {
  const q = useList('/trips/', { status: 'DISPATCHED', page_size: 6, ordering: 'departed_at' })
  const [returning, setReturning] = useState(null)
  const [now] = useState(() => Date.now()) // render-stable clock; the list refetches on focus anyway
  const count = q.data?.count ?? 0
  if (!count) return null

  return (
    <section aria-labelledby="out-now" className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-brand opacity-50 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
        </span>
        <h2 id="out-now" className="text-sm font-semibold text-ink">Out right now <span className="font-normal text-slate-500">· {count} {count === 1 ? 'vehicle' : 'vehicles'}</span></h2>
        {count > q.data.results.length && (
          <button type="button" onClick={onViewAll} className="ml-auto text-sm font-medium text-brand hover:underline">View all {count}</button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {q.data.results.map((t) => {
          const long = (now - new Date(t.departed_at)) / 36e5 > LONG_TRIP_HOURS
          return (
            <article key={t.id} className={`flex flex-col rounded-xl border border-l-4 bg-white p-4 shadow-sm ${long ? 'border-amber-300 border-l-amber-500' : 'border-slate-200 border-l-brand'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{t.plate_number}</div>
                  <div className="text-xs text-slate-500">{t.vehicle_label} · {t.driver_name}</div>
                </div>
                <Link to={`/trips/${t.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{t.ticket_number}</Link>
              </div>
              <p className="mt-2 truncate text-sm" title={t.destination}><span className="text-slate-500">To</span> {t.destination}</p>
              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-sm">
                <Clock size={15} className={long ? 'text-amber-600' : 'text-slate-400'} aria-hidden="true" />
                <span className={long ? 'font-medium text-amber-800' : 'text-slate-600'}>
                  Out {tripDuration(t.departed_at)}{long && ' · long trip'}
                </span>
                {canChange && (
                  <Button variant="secondary" className="ml-auto min-h-9" onClick={() => setReturning(t)}>
                    <CircleCheck size={16} /> Record return
                  </Button>
                )}
              </div>
            </article>
          )
        })}
      </div>
      <Modal open={!!returning} onClose={() => setReturning(null)} title={`Record return: ${returning?.ticket_number}`}>
        {returning && <CompleteForm trip={returning} onClose={() => setReturning(null)} />}
      </Modal>
    </section>
  )
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

  const setRange = (from, to) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    for (const [k, v] of [['date_from', from], ['date_to', to]]) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    next.delete('page')
    return next
  }, { replace: true })
  const [presets] = useState(datePresets)

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
      <div role="group" aria-label="Date range" className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
        {presets.map(([label, from, to]) => {
          const on = f.date_from === from && f.date_to === to
          return (
            <button key={label} type="button" aria-pressed={on} onClick={() => (on ? setRange('', '') : setRange(from, to))}
              className={`h-9 border-r border-slate-300 px-3 last:border-r-0 ${on ? 'bg-brand text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              {label}
            </button>
          )
        })}
      </div>
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
            <span className="mt-1 block text-xs text-slate-500">Distance, completed trips</span>
          </span>
        </div>
      </CardGrid>

      <OpenTrips canChange={can('operations.change_trip')} onViewAll={() => set('status', 'DISPATCHED')} />

      <DataTable columns={tripColumns()} query={query} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
        onRowClick={(t) => navigate(`/trips/${t.id}`)}
        empty={chips.length ? 'No trips match these filters.' : 'No trips yet.'} />

      <Modal open={dispatching} onClose={() => setDispatching(false)} title="Dispatch trip" wide>
        {dispatching && <DispatchForm onClose={() => setDispatching(false)} onSaved={(t) => navigate(`/trips/${t.id}`)} />}
      </Modal>
    </div>
  )
}
