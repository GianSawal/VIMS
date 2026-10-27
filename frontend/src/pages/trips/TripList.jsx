import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarClock, CalendarDays, CalendarPlus, CircleCheck, CircleSlash, Clock, List, MapPin, Milestone, Monitor, Navigation, Plus, Route as RouteIcon } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import DateChip from '../../components/DateChip'
import { Avatar, CardGrid, SearchBox, selectClass, StatCard, Toolbar } from '../../components/filters'
import { Button, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { VehiclePhoto } from '../vehicles/common'
import DispatchForm from './DispatchForm'
import TripCalendar from './TripCalendar'
import TvScreens from './TvScreens'
import { CompleteForm, DispatchScheduledForm } from './TripDetail'
import { km, shortDateTime, TRIP_STATUSES, tripDuration, tripStatusLabel, TripStatusBadge } from './common'

const CARDS = {
  ALL: [RouteIcon, 'bg-slate-100 text-slate-700', 'All trips'],
  SCHEDULED: [CalendarClock, 'bg-amber-50 text-amber-700', 'Scheduled'],
  DISPATCHED: [Navigation, 'bg-brand-light text-brand', 'On trip now'],
  COMPLETED: [CircleCheck, 'bg-green-50 text-green-700', 'Completed'],
  CANCELLED: [CircleSlash, 'bg-slate-100 text-slate-500', 'Cancelled'],
}
const card = (t) => ({ icon: CARDS[t][0], tint: CARDS[t][1], label: CARDS[t][2] })

const clock = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })

/** Vehicle photo and driver (photo or initials) for the live trip cards. */
function TripIdentity({ t }) {
  return (
    <div className="flex gap-3">
      <VehiclePhoto vehicle={{ photo_url: t.vehicle_photo_url, plate_number: t.plate_number, make: '', model: t.vehicle_label }} className="w-28 shrink-0 border border-slate-200" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold tracking-wide">{t.plate_number}</div>
        <div className="truncate text-xs text-slate-500">{t.vehicle_label}</div>
        <div className="mt-2 flex items-center gap-2">
          <Avatar name={t.driver_name} src={t.driver_photo_url} className="h-8! w-8! text-xs" />
          <span className="min-w-0"><span className="block text-[11px] leading-none text-slate-500">Driver</span><span className="block truncate text-sm font-medium">{t.driver_name}</span></span>
        </div>
      </div>
    </div>
  )
}

/** What happened / happens at what time, in words, for the "When" column. */
function whenText(t) {
  if (t.status === 'SCHEDULED') {
    const extra = t.schedule_day === 'MISSED' ? ['Missed: reschedule', 'text-danger font-medium']
      : t.schedule_day === 'TODAY' ? ['Leaves today', 'text-amber-700 font-medium'] : ['Booked', 'text-slate-500']
    return [`Leaves ${clock.format(new Date(t.scheduled_departure))}`, ...extra]
  }
  if (t.status === 'DISPATCHED') return [`Left ${clock.format(new Date(t.departed_at))}`, `Out ${tripDuration(t.departed_at)}`, 'text-brand font-medium']
  if (t.status === 'COMPLETED') return [`Left ${clock.format(new Date(t.departed_at))}`, `Back ${shortDateTime(t.returned_at)} · ${tripDuration(t.departed_at, t.returned_at)}`, 'text-slate-500']
  return [t.departed_at ? `Left ${clock.format(new Date(t.departed_at))}` : `Was ${clock.format(new Date(t.scheduled_departure))}`, 'Cancelled', 'text-slate-500']
}

/** Trip table columns, shared with the vehicle Trips tab (`withVehicle` = false there). */
export function tripColumns({ withVehicle = true } = {}) {
  return [
    { key: 'when', label: 'When', render: (t) => {
      const [main, sub, subCls] = whenText(t)
      return (
        <div className="flex items-center gap-3">
          <DateChip value={t.departed_at ?? t.scheduled_departure} to={`/trips/${t.id}`} muted={t.status === 'CANCELLED'} />
          <div className="whitespace-nowrap">
            <div className="font-medium tabular-nums">{main}</div>
            <div className={`text-xs ${subCls}`}>{sub}</div>
          </div>
        </div>
      )
    } },
    { key: 'ticket', label: 'Trip ticket', render: (t) => (
      <div className="min-w-0">
        <Link to={`/trips/${t.id}`} onClick={(e) => e.stopPropagation()}
          className="inline-block rounded-md border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-brand hover:border-brand">{t.ticket_number}</Link>
        <div className="mt-1 max-w-52 truncate text-xs text-slate-500" title={t.purpose}>{t.purpose}</div>
      </div>
    ) },
    ...(withVehicle ? [{ key: 'vehicle', label: 'Vehicle and driver', render: (t) => (
      <div className="flex items-center gap-3">
        <VehiclePhoto vehicle={{ photo_url: t.vehicle_photo_url, plate_number: t.plate_number, make: '', model: t.vehicle_label }} className="w-16 shrink-0 border border-slate-200" />
        <div className="min-w-0">
          <div className="font-semibold tracking-wide">{t.plate_number}</div>
          <div className="truncate text-xs text-slate-500">{t.vehicle_label}</div>
          <div className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-600"><Avatar name={t.driver_name} src={t.driver_photo_url} className="h-5! w-5! text-[9px]" />{t.driver_name}</div>
        </div>
      </div>
    ) }] : [{ key: 'driver', label: 'Driver', render: (t) => (
      <span className="flex items-center gap-2"><Avatar name={t.driver_name} src={t.driver_photo_url} className="h-7! w-7! text-[10px]" />{t.driver_name}</span>
    ) }]),
    { key: 'route', label: 'Route', render: (t) => (
      <ol className="relative max-w-64 space-y-1 pl-4 text-sm" aria-label={`From ${t.origin} to ${t.destination}`}>
        <span aria-hidden="true" className="absolute top-2 bottom-2 left-[3px] w-px bg-slate-300" />
        <li className="relative truncate" title={t.origin}>
          <span aria-hidden="true" className="absolute top-1.5 -left-4 h-2 w-2 rounded-full bg-brand ring-2 ring-white" />{t.origin}
        </li>
        <li className="relative truncate font-medium" title={t.destination}>
          <MapPin size={12} aria-hidden="true" className="absolute top-1 -left-[18px] text-accent" />{t.destination}
        </li>
      </ol>
    ) },
    { key: 'distance', label: 'Distance', className: 'text-right', render: (t) => t.distance_km != null
      ? <span className="inline-flex items-baseline gap-1 rounded-full bg-brand-light px-2.5 py-0.5 text-brand"><span className="font-semibold tabular-nums">{t.distance_km.toLocaleString('en-PH')}</span><span className="text-[11px]">km</span></span>
      : <span className="text-xs text-slate-400">{t.status === 'DISPATCHED' ? 'On the road' : t.status === 'SCHEDULED' ? 'Not yet' : '—'}</span> },
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
/** Today's bookings that haven't left yet: dispatch them here by entering the odometer. */
function LeavingToday({ canChange }) {
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'))
  const q = useList('/trips/', { status: 'SCHEDULED', date_from: today, date_to: today, ordering: 'scheduled_departure', page_size: 12 })
  const [leaving, setLeaving] = useState(null)
  const rows = q.data?.results ?? []
  if (!rows.length) return null

  return (
    <section aria-labelledby="leaving-today" className="mb-4">
      <h2 id="leaving-today" className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <CalendarClock size={16} className="text-amber-600" aria-hidden="true" />
        Leaving today <span className="font-normal text-slate-500">· {rows.length} scheduled</span>
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((t) => (
          <article key={t.id} className="flex flex-col rounded-xl border border-l-4 border-slate-200 border-l-amber-500 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-lg font-semibold text-amber-700 tabular-nums">
                <Clock size={16} aria-hidden="true" />{new Date(t.scheduled_departure).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}
              </div>
              <Link to={`/trips/${t.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{t.ticket_number}</Link>
            </div>
            <TripIdentity t={t} />
            <p className="mt-2 truncate text-sm" title={t.destination}><span className="text-slate-500">To</span> {t.destination}</p>
            {canChange && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <Button className="w-full" onClick={() => setLeaving(t)}><Navigation size={16} /> Dispatch: enter odometer</Button>
              </div>
            )}
          </article>
        ))}
      </div>
      <Modal open={!!leaving} onClose={() => setLeaving(null)} title={`Dispatch ${leaving?.ticket_number}`}>
        {leaving && <DispatchScheduledForm trip={leaving} onClose={() => setLeaving(null)} />}
      </Modal>
    </section>
  )
}

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
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold tracking-wider text-brand uppercase">On trip</span>
                <Link to={`/trips/${t.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{t.ticket_number}</Link>
              </div>
              <TripIdentity t={t} />
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
  const [newTrip, setNewTrip] = useState(null) // 'schedule' | 'dispatch'
  const [tv, setTv] = useState(false)
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

  const calendar = f.status === 'SCHEDULED' && f.view !== 'list' // the month replaces the date range
  // Opening the calendar scrolls it to the top so the whole month fits on screen.
  const viewToggle = useRef(null)
  useEffect(() => { if (calendar) viewToggle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [calendar])
  const toolbar = (
    <Toolbar chips={chips} onRemove={remove} onClear={clearAll}>
      <SearchBox id="trip-search" label="Search trips" placeholder="Search ticket, plate, driver, destination…" value={search} onChange={setSearch} />
      {showOffice && (
        <select className={`${selectClass} w-44`} aria-label="Filter by vehicle office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
          <option value="">All offices</option>
          {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      )}
      {!calendar && <>
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
      </>}
    </Toolbar>
  )

  return (
    <div>
      <PageHeader title="Trips" actions={(
        <div className="flex gap-2">
          {can('operations.view_displayscreen') && <Button variant="secondary" onClick={() => setTv(true)}><Monitor size={16} /> TV board</Button>}
          {can('operations.add_trip') && <>
            <Button variant="secondary" onClick={() => setNewTrip('schedule')}><CalendarPlus size={16} /> Schedule trip</Button>
            <Button onClick={() => setNewTrip('dispatch')}><Plus size={16} /> Dispatch now</Button>
          </>}
        </div>
      )}>Book trips ahead, dispatch on the day and record returns.</PageHeader>

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

      {!calendar && <>
        <LeavingToday canChange={can('operations.change_trip')} />
        <OpenTrips canChange={can('operations.change_trip')} onViewAll={() => set('status', 'DISPATCHED')} />
      </>}

      {f.status === 'SCHEDULED' && (
        <div ref={viewToggle} role="group" aria-label="Scheduled view" className="mb-2 flex w-fit overflow-hidden rounded-md border border-slate-300 text-sm">
          {[['', CalendarDays, 'Calendar'], ['list', List, 'List']].map(([value, Icon, label]) => (
            <button key={label} type="button" aria-pressed={(f.view ?? '') === value} onClick={() => set('view', value)}
              className={`flex h-9 items-center gap-1.5 border-r border-slate-300 px-3 last:border-r-0 ${(f.view ?? '') === value ? 'bg-brand text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              <Icon size={15} aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      )}
      {calendar
        ? <TripCalendar month={f.month} onMonth={(m) => set('month', m)} filters={{ search: f.search, office: f.office }} toolbar={toolbar} />
        : <DataTable columns={tripColumns()} query={query} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
          onRowClick={(t) => navigate(`/trips/${t.id}`)}
          empty={chips.length ? 'No trips match these filters.' : 'No trips yet.'} />}

      <Modal open={tv} onClose={() => setTv(false)} title="TV trip board" wide>
        {tv && <TvScreens />}
      </Modal>
      <Modal open={!!newTrip} onClose={() => setNewTrip(null)} title={newTrip === 'schedule' ? 'Schedule a trip' : 'Dispatch a trip now'} wide>
        {newTrip && <DispatchForm mode={newTrip} onClose={() => setNewTrip(null)} onSaved={(t) => navigate(`/trips/${t.id}`)} />}
      </Modal>
    </div>
  )
}
