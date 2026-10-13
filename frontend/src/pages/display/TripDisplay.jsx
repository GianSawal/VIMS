import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CalendarDays, Car, CircleCheck, Clock, Navigation, TriangleAlert, WifiOff } from 'lucide-react'
import { api } from '../../api'
import { initials } from '../../components/filters'

/*
 * Wall TV board: /display?token=<screen token>. No staff login; the token is created in Django admin
 * (Operations > Display screens) and revoked by unticking "is active". Designed for 1920x1080 landscape.
 *
 * Departures-board layout: today's trips in one table (out now, then later today, then returned),
 * with today's counts and the next 7 days beside it. Soft blue-gray background: calm on a TV, not glaring.
 */

const REFRESH_MS = 60_000
const PAGE_MS = 12_000
const ROWS = 6 // table rows that fit at TV size; longer lists page automatically
const AGENDA_ROWS = 4

const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const t = (v) => (v ? timeFmt.format(new Date(v)) : '')
const dayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const wk = new Intl.DateTimeFormat('en-PH', { weekday: 'short' })
const mon = new Intl.DateTimeFormat('en-PH', { month: 'short' })

/** 135 -> "2h 15m", 50 -> "50 min" */
function span(minutes) {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}
const since = (v, now) => (now - new Date(v)) / 60_000

const ORDER = { DISPATCHED: 0, SCHEDULED: 1, COMPLETED: 2, CANCELLED: 3 }
const sortKey = (r) => new Date(r.status === 'COMPLETED' ? r.returned_at : r.departed_at ?? r.scheduled_departure).getTime()

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function usePager(count, size) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(count / size))
  useEffect(() => {
    if (pages < 2) return undefined
    const id = setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS)
    return () => clearInterval(id)
  }, [pages])
  return [page % pages, pages] // the list may shrink between refreshes
}

export default function TripDisplay() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const now = useClock()
  const q = useQuery({
    queryKey: ['display', token],
    queryFn: () => api.get('/display/trips/', { params: { token } }).then((r) => r.data),
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    retry: (n, err) => err?.response?.status !== 403,
    placeholderData: keepPreviousData,
    enabled: !!token,
  })

  const today = [...(q.data?.today ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || sortKey(a) - sortKey(b))
  const upcoming = q.data?.upcoming ?? []
  const count = (s) => today.filter((r) => r.status === s).length
  const late = today.filter((r) => r.flag).length
  const [page, pages] = usePager(today.length, ROWS)
  const rows = today.slice(page * ROWS, (page + 1) * ROWS)

  if (!token || q.error?.response?.status === 403) {
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center p-16">
          <div className="max-w-3xl rounded-3xl bg-slate-50 p-14 text-center shadow-xl ring-1 ring-slate-300">
            <img src="/dole-emblem.png" alt="" className="mx-auto mb-8 h-28 w-28" />
            <p className="text-5xl font-bold text-brand">Display not set up</p>
            <p className="mt-6 text-2xl text-slate-600">This display link is missing, invalid or has been turned off.<br />Ask the System Administrator for a new link.</p>
          </div>
        </div>
      </Screen>
    )
  }

  return (
    <Screen>
      <style>{'@keyframes vrs-page { from { transform: scaleX(0) } to { transform: scaleX(1) } } @keyframes vrs-fade { from { opacity: 0 } to { opacity: 1 } }'}</style>

      <header className="relative flex items-center gap-7 bg-gradient-to-r from-brand-dark to-brand px-12 py-5 text-white">
        <img src="/dole-emblem.png" alt="DOLE emblem" className="h-[88px] w-[88px] rounded-full bg-white p-1.5 shadow-lg" />
        <div className="mr-auto">
          <div className="text-lg font-semibold tracking-[0.25em] text-gold uppercase">Department of Labor and Employment</div>
          <div className="text-[46px] leading-tight font-bold tracking-tight">Vehicle Trip Board</div>
          {q.data?.office && <div className="text-xl text-white/80">{q.data.office.name}</div>}
        </div>
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-lg font-semibold ring-1 ring-white/25">
            <span className={`h-3 w-3 rounded-full ${q.isError ? 'bg-amber-400' : 'bg-emerald-400 motion-safe:animate-pulse'}`} aria-hidden="true" />
            {q.isError ? 'Offline' : 'Live'}
          </span>
          <div className="text-right">
            <div className="text-[68px] leading-none font-bold tracking-tight tabular-nums">{timeFmt.format(now)}</div>
            <div className="mt-1 text-xl text-white/85">{dayFmt.format(now)}</div>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-gold" aria-hidden="true" />
      </header>

      {q.isError && q.data && (
        <div role="status" className="flex items-center gap-3 bg-amber-100 px-12 py-3 text-2xl font-semibold text-amber-900">
          <WifiOff size={28} aria-hidden="true" /> Connection lost. Showing the schedule from {t(q.data.generated_at)}. Retrying…
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_520px] gap-8 px-12 py-7">
        {/* Today's board */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-lg ring-1 ring-slate-300/80">
          <div className="flex items-center gap-4 border-b border-slate-200 px-8 py-5">
            <h2 className="mr-auto text-[32px] font-bold text-ink">Today’s trips</h2>
            {pages > 1 && <span className="text-xl font-medium text-slate-500">Page {page + 1} of {pages}</span>}
          </div>
          <div className="grid grid-cols-[190px_330px_1fr_220px] gap-6 bg-slate-200/70 px-8 py-3 text-base font-bold tracking-[0.15em] text-slate-600 uppercase">
            <span>Time</span><span>Vehicle and driver</span><span>Destination</span><span className="text-right">Status</span>
          </div>
          {q.isLoading ? <p className="p-8 text-2xl text-slate-500">Loading…</p> : today.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <span className="flex h-28 w-28 items-center justify-center rounded-full bg-brand-light text-brand"><Car size={56} strokeWidth={1.5} aria-hidden="true" /></span>
              <p className="mt-6 text-4xl font-bold text-ink">No trips today</p>
              <p className="mt-2 text-2xl text-slate-500">{upcoming.length ? `Next trip: ${wk.format(new Date(upcoming[0].scheduled_departure))} at ${t(upcoming[0].scheduled_departure)}` : 'All vehicles are in the motor pool.'}</p>
            </div>
          ) : (
            <ol key={page} className="min-h-0 flex-1 divide-y divide-slate-200 motion-safe:animate-[vrs-fade_.5s_ease]">
              {rows.map((r) => <Row key={r.ticket_number} r={r} now={now} />)}
            </ol>
          )}
          {pages > 1 && (
            <div className="h-1.5 bg-slate-200" aria-hidden="true">
              <div key={page} className="h-full origin-left bg-brand" style={{ animation: `vrs-page ${PAGE_MS}ms linear` }} />
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-7">
          {/* At a glance */}
          <section className="rounded-2xl bg-slate-50 p-6 shadow-lg ring-1 ring-slate-300/80">
            <h2 className="mb-4 text-[26px] font-bold text-ink">Today at a glance</h2>
            <div className="grid grid-cols-2 gap-4">
              <Kpi icon={Navigation} value={count('DISPATCHED')} label="On trip now" tone="bg-brand text-white" />
              <Kpi icon={Clock} value={count('SCHEDULED')} label="Still to leave" tone="bg-gold text-ink" />
              <Kpi icon={CircleCheck} value={count('COMPLETED')} label="Returned" tone="bg-emerald-600 text-white" />
              <Kpi icon={TriangleAlert} value={late} label="Running late" tone={late ? 'bg-danger text-white' : 'bg-slate-300 text-slate-600'} alert={late > 0} />
            </div>
          </section>

          {/* Next 7 days */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-lg ring-1 ring-slate-300/80">
            <h2 className="flex items-center gap-3 border-b border-slate-200 px-6 py-4 text-[26px] font-bold text-ink">
              <CalendarDays size={28} className="text-brand" aria-hidden="true" /> Next 7 days
              <span className="ml-auto rounded-full bg-brand-light px-3 py-0.5 text-lg font-semibold text-brand">{upcoming.length} booked</span>
            </h2>
            {upcoming.length === 0 ? <p className="p-6 text-2xl text-slate-500">No trips booked yet.</p> : (
              <ul className="min-h-0 flex-1 divide-y divide-slate-200 overflow-hidden">
                {upcoming.slice(0, AGENDA_ROWS).map((r, i) => {
                  const d = new Date(r.scheduled_departure)
                  const newDay = i === 0 || new Date(upcoming[i - 1].scheduled_departure).toDateString() !== d.toDateString()
                  return (
                    <li key={r.ticket_number} className="flex items-center gap-4 px-6 py-2">
                      <span className={`flex w-[72px] shrink-0 flex-col items-center rounded-xl py-1 ${newDay ? 'bg-brand text-white' : ''}`} aria-hidden={!newDay}>
                        {newDay && <>
                          <span className="text-sm font-bold tracking-widest text-gold uppercase">{wk.format(d)}</span>
                          <span className="text-[28px] leading-none font-bold">{d.getDate()}</span>
                          <span className="text-sm text-white/80">{mon.format(d)}</span>
                        </>}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-3">
                          <span className="text-2xl font-bold text-ink tabular-nums">{t(r.scheduled_departure)}</span>
                          <Plate small>{r.plate_number}</Plate>
                        </span>
                        <span className="mt-0.5 block truncate text-xl text-slate-600">{r.destination}</span>
                      </span>
                    </li>
                  )
                })}
                {upcoming.length > AGENDA_ROWS && <li className="px-6 py-2 text-xl font-medium text-slate-500">+{upcoming.length - AGENDA_ROWS} more this week</li>}
              </ul>
            )}
          </section>
        </aside>
      </main>

      <footer className="flex items-center justify-between bg-brand-dark px-12 py-3 text-lg text-white/80">
        <span className="font-medium text-white">{q.data?.screen}</span>
        <span>{q.data?.office ? `${q.data.office.code} vehicles` : 'All offices'} · for trip changes, see the Fleet Administrator</span>
        <span className="tabular-nums">{q.data ? `Updated ${t(q.data.generated_at)} · refreshes every minute` : ''}</span>
      </footer>
    </Screen>
  )
}

/** Status chip label/colors and the row's left accent. */
function status(r) {
  if (r.flag === 'OVERDUE') return ['Overdue', 'bg-danger text-white', 'border-l-danger']
  if (r.flag === 'DELAYED') return ['Delayed', 'bg-danger text-white', 'border-l-danger']
  return {
    DISPATCHED: ['On trip', 'bg-brand text-white', 'border-l-brand'],
    SCHEDULED: ['Scheduled', 'bg-gold text-ink', 'border-l-gold'],
    COMPLETED: ['Returned', 'bg-emerald-600 text-white', 'border-l-emerald-600'],
    CANCELLED: ['Cancelled', 'bg-slate-400 text-white', 'border-l-slate-300'],
  }[r.status]
}

function Row({ r, now }) {
  const [label, chip, edge] = status(r)
  const cancelled = r.status === 'CANCELLED'
  const [verb, time] = r.status === 'DISPATCHED' ? ['Left', r.departed_at]
    : r.status === 'COMPLETED' ? ['Returned', r.returned_at]
      : [cancelled ? 'Was at' : 'Departs', r.scheduled_departure]
  let note = null
  if (r.status === 'DISPATCHED') {
    note = r.flag === 'OVERDUE'
      ? <span className="font-bold text-danger">Due back {t(r.scheduled_return)} · {span(since(r.scheduled_return, now))} late</span>
      : <>Out {span(since(r.departed_at, now))}{r.scheduled_return && <> · back by <strong className="text-ink">{t(r.scheduled_return)}</strong></>}</>
  } else if (r.status === 'SCHEDULED') {
    note = r.flag === 'DELAYED' ? <span className="font-bold text-danger">Not yet left · {span(since(r.scheduled_departure, now))} past departure</span>
      : r.scheduled_return ? <>Until {t(r.scheduled_return)}</> : 'Whole day'
  } else if (r.status === 'COMPLETED' && r.departed_at) {
    note = <>Left {t(r.departed_at)} · trip took {span((new Date(r.returned_at) - new Date(r.departed_at)) / 60_000)}</>
  }

  return (
    <li className={`grid grid-cols-[190px_330px_1fr_220px] items-center gap-6 border-l-8 px-8 py-4 odd:bg-white even:bg-slate-50 ${edge} ${cancelled ? 'opacity-55' : ''}`}>
      <div>
        <div className="text-base font-semibold tracking-wider text-slate-500 uppercase">{verb}</div>
        <div className={`text-[34px] leading-tight font-bold tabular-nums ${r.flag ? 'text-danger' : 'text-ink'}`}>{t(time)}</div>
      </div>
      <div className="flex min-w-0 items-center gap-4">
        <div className="relative h-[72px] w-[108px] shrink-0 overflow-hidden rounded-lg bg-slate-200 ring-1 ring-slate-300">
          {r.vehicle_photo_url
            ? <img src={r.vehicle_photo_url} alt="" className="h-full w-full object-cover" />
            : <Car size={36} strokeWidth={1.5} className="absolute inset-0 m-auto text-slate-400" aria-hidden="true" />}
        </div>
        <div className="min-w-0">
          <Plate>{r.plate_number}</Plate>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-bold text-brand" aria-hidden="true">{initials(r.driver_name)}</span>
            <span className="truncate text-lg font-medium text-slate-700">{r.driver_name}</span>
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <div className={`truncate text-[28px] leading-tight font-bold text-ink ${cancelled ? 'line-through decoration-2' : ''}`} title={r.destination}>{r.destination}</div>
        {note && <div className="mt-1 truncate text-xl text-slate-600">{note}</div>}
      </div>
      <div className="text-right">
        <span className={`inline-block min-w-[170px] rounded-lg px-4 py-2 text-center text-xl font-bold tracking-wider uppercase shadow-sm ${chip}`}>{label}</span>
      </div>
    </li>
  )
}

/** License-plate style tag: white plate, dark border, spaced letters. */
function Plate({ children, small }) {
  return (
    <span className={`inline-block rounded-md border-2 border-ink bg-white font-bold tracking-[0.12em] text-ink shadow-[inset_0_-3px_0_rgba(3,5,186,0.15)] ${small ? 'px-2 text-lg' : 'px-3 py-0.5 text-2xl'}`}>
      {children}
    </span>
  )
}

function Kpi({ icon: Icon, value, label, tone, alert }) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${tone} ${alert ? 'motion-safe:animate-pulse' : ''}`}>
        <Icon size={30} aria-hidden="true" />
      </span>
      <span>
        <span className="block text-[44px] leading-none font-bold text-ink tabular-nums">{value}</span>
        <span className="mt-1 block text-lg text-slate-600">{label}</span>
      </span>
    </div>
  )
}

// Soft blue-gray canvas with off-white panels: readable across a room without the glare of pure white.
function Screen({ children }) {
  return <div className="flex h-screen flex-col overflow-hidden bg-[#dfe5ee]">{children}</div>
}
