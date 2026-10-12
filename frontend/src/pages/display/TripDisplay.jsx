import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CalendarDays, Car, CircleCheck, Clock, MapPin, Navigation, TriangleAlert, WifiOff } from 'lucide-react'
import { api } from '../../api'
import { initials } from '../../components/filters'

/*
 * Wall TV board: /display?token=<screen token>. No staff login; the token is created in Django admin
 * (Operations > Display screens) and revoked by unticking "is active". Designed for 1920x1080 landscape.
 *
 * Left: vehicles on the road now (cards, paged). Right: departures later today, then the next 7 days.
 */

const REFRESH_MS = 60_000
const PAGE_MS = 12_000
const CARDS_PER_PAGE = 6 // 2 x 3 at TV size; more vehicles page automatically
const LATER_ROWS = 5
const UPCOMING_ROWS = 4

const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const t = (v) => (v ? timeFmt.format(new Date(v)) : '')
const dayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const weekday = new Intl.DateTimeFormat('en-PH', { weekday: 'long' })
const monthDay = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })

/** 135 -> "2h 15m", 50 -> "50 min" (short enough for the card columns) */
function span(minutes) {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}
const minutesSince = (v, now) => (now - new Date(v)) / 60_000

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

  const today = q.data?.today ?? []
  const onRoad = today.filter((r) => r.status === 'DISPATCHED')
  const later = today.filter((r) => r.status === 'SCHEDULED' || r.status === 'CANCELLED')
  const back = today.filter((r) => r.status === 'COMPLETED')
  const upcoming = q.data?.upcoming ?? []
  const alerts = today.filter((r) => r.flag).length
  const [page, pages] = usePager(onRoad.length, CARDS_PER_PAGE)
  const cards = onRoad.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE)

  if (!token || q.error?.response?.status === 403) {
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center p-16 text-center">
          <div>
            <img src="/dole-emblem.png" alt="" className="mx-auto mb-8 h-28 w-28 rounded-full bg-white p-3" />
            <p className="text-5xl font-bold">Display not set up</p>
            <p className="mt-6 text-2xl text-slate-300">This display link is missing, invalid or has been turned off.<br />Ask the System Administrator for a new link.</p>
          </div>
        </div>
      </Screen>
    )
  }

  return (
    <Screen>
      <style>{'@keyframes vrs-page { from { transform: scaleX(0) } to { transform: scaleX(1) } } @keyframes fadein { from { opacity: 0 } to { opacity: 1 } }'}</style>

      {/* Header */}
      <header className="relative flex items-center gap-6 bg-gradient-to-r from-brand-dark via-brand to-brand-dark px-12 py-5 shadow-lg shadow-black/40">
        <span className="flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-full bg-white shadow-md">
          <img src="/dole-emblem.png" alt="DOLE emblem" className="h-16 w-16 object-contain" />
        </span>
        <div className="mr-auto">
          <div className="text-lg font-semibold tracking-[0.2em] text-gold uppercase">DOLE Vehicle Records System</div>
          <div className="text-[44px] leading-tight font-bold">
            Trip Board{q.data?.office && <span className="font-medium text-white/75"> · {q.data.office.name}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[64px] leading-none font-bold tracking-tight tabular-nums">{timeFmt.format(now)}</div>
          <div className="mt-2 text-xl text-white/80">{dayFmt.format(now)}</div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-gold via-accent to-gold" aria-hidden="true" />
      </header>

      {q.isError && q.data && (
        <div role="status" className="flex items-center gap-3 bg-danger px-12 py-3 text-2xl font-semibold">
          <WifiOff size={28} aria-hidden="true" /> Connection lost. Showing the schedule from {t(q.data.generated_at)}. Retrying…
        </div>
      )}

      {/* Counts */}
      <div className="grid grid-cols-4 gap-6 px-12 pt-6">
        <Stat icon={Navigation} tone="from-chart/40 to-chart/10 text-blue-200 ring-chart/40" value={onRoad.length} label="On the road now" />
        <Stat icon={Clock} tone="from-gold/30 to-gold/5 text-gold ring-gold/30" value={later.filter((r) => r.status === 'SCHEDULED').length} label="Leaving later today" />
        <Stat icon={CircleCheck} tone="from-emerald-500/30 to-emerald-500/5 text-emerald-300 ring-emerald-500/30" value={back.length} label="Returned today" />
        {alerts > 0
          ? <Stat icon={TriangleAlert} tone="from-danger/60 to-danger/20 text-white ring-red-400/60" value={alerts} label={alerts === 1 ? 'Trip running late' : 'Trips running late'} pulse />
          : <Stat icon={CalendarDays} tone="from-white/15 to-white/5 text-slate-200 ring-white/15" value={upcoming.length} label="Booked next 7 days" />}
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_560px] gap-8 px-12 py-6">
        {/* On the road */}
        <section className="flex min-h-0 flex-col">
          <SectionTitle icon={Navigation} title="On the road now">
            {pages > 1 && (
              <span className="flex items-center gap-2" aria-label={`Page ${page + 1} of ${pages}`}>
                {Array.from({ length: pages }, (_, i) => (
                  <span key={i} className={`h-2.5 rounded-full transition-all ${i === page ? 'w-8 bg-gold' : 'w-2.5 bg-white/25'}`} />
                ))}
              </span>
            )}
          </SectionTitle>
          {q.isLoading ? <Placeholder>Loading…</Placeholder> : onRoad.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 bg-white/[0.03] text-center">
              <Car size={96} strokeWidth={1.25} className="text-white/25" aria-hidden="true" />
              <p className="mt-6 text-4xl font-semibold">No vehicles out right now</p>
              <p className="mt-3 text-2xl text-slate-400">{later.some((r) => r.status === 'SCHEDULED') ? `Next departure at ${t(later.find((r) => r.status === 'SCHEDULED').scheduled_departure)}` : 'All vehicles are in the motor pool.'}</p>
            </div>
          ) : (
            <div key={page} className="grid flex-1 auto-rows-fr grid-cols-2 grid-rows-3 gap-5 motion-safe:animate-[fadein_.5s_ease]">
              {cards.map((r) => <TripCard key={r.ticket_number} r={r} now={now} />)}
            </div>
          )}
          {pages > 1 && (
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <div key={page} className="h-full origin-left bg-gold/70" style={{ animation: `vrs-page ${PAGE_MS}ms linear` }} />
            </div>
          )}
        </section>

        {/* Right column */}
        <aside className="flex min-h-0 flex-col gap-6">
          <section className="rounded-3xl bg-white/[0.05] p-6 ring-1 ring-white/10">
            <SectionTitle icon={Clock} title="Later today" small />
            {later.length === 0 ? <p className="text-2xl text-slate-400">No more departures today.</p> : (
              <ul className="divide-y divide-white/10">
                {later.slice(0, LATER_ROWS).map((r) => {
                  const cancelled = r.status === 'CANCELLED'
                  return (
                    <li key={r.ticket_number} className={`flex items-center gap-5 py-2.5 ${cancelled ? 'opacity-45' : ''}`}>
                      <span className={`w-36 shrink-0 text-3xl font-bold tabular-nums ${r.flag ? 'text-red-300' : 'text-gold'}`}>{t(r.scheduled_departure)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-2xl font-semibold ${cancelled ? 'line-through decoration-2' : ''}`}>
                          {r.plate_number} <span className="font-normal text-slate-300">→ {r.destination}</span>
                        </span>
                        <span className="block truncate text-lg text-slate-400">{r.driver_name}</span>
                      </span>
                      {r.flag && <Pill className="bg-danger">Delayed</Pill>}
                      {cancelled && <Pill className="bg-slate-600">Cancelled</Pill>}
                    </li>
                  )
                })}
                {later.length > LATER_ROWS && <li className="pt-3 text-xl text-slate-400">+{later.length - LATER_ROWS} more today</li>}
              </ul>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-3xl bg-white/[0.05] p-6 ring-1 ring-white/10">
            <SectionTitle icon={CalendarDays} title="Coming up" small />
            {upcoming.length === 0 ? <p className="text-2xl text-slate-400">No trips booked for the next 7 days.</p> : (
              <ul className="space-y-2 overflow-hidden">
                {upcoming.slice(0, UPCOMING_ROWS).map((r, i) => {
                  const d = new Date(r.scheduled_departure)
                  const newDay = i === 0 || new Date(upcoming[i - 1].scheduled_departure).toDateString() !== d.toDateString()
                  return (
                    <li key={r.ticket_number} className="flex items-center gap-4">
                      <span className={`flex w-20 shrink-0 flex-col items-center rounded-xl py-0.5 ${newDay ? 'bg-white/10' : ''}`}>
                        {newDay && <>
                          <span className="text-sm font-semibold tracking-wider text-gold uppercase">{weekday.format(d).slice(0, 3)}</span>
                          <span className="text-lg leading-tight font-bold">{monthDay.format(d)}</span>
                        </>}
                      </span>
                      <span className="w-28 shrink-0 text-2xl font-semibold tabular-nums">{t(r.scheduled_departure)}</span>
                      <span className="min-w-0 flex-1 truncate text-2xl"><span className="font-semibold">{r.plate_number}</span> <span className="text-slate-300">→ {r.destination}</span></span>
                    </li>
                  )
                })}
                {upcoming.length > UPCOMING_ROWS && <li className="pl-24 text-xl text-slate-400">+{upcoming.length - UPCOMING_ROWS} more this week</li>}
              </ul>
            )}
          </section>
        </aside>
      </main>

      <footer className="flex items-center justify-between border-t border-white/10 px-12 py-3 text-lg text-slate-400">
        <span>{q.data?.screen}</span>
        <span>{back.length > 0 && <>Back today: {back.slice(0, 4).map((r) => `${r.plate_number} ${t(r.returned_at)}`).join(' · ')}{back.length > 4 ? ` · +${back.length - 4}` : ''}</>}</span>
        <span>{q.data ? `Updated ${t(q.data.generated_at)} · refreshes every minute` : ''}</span>
      </footer>
    </Screen>
  )
}

/** One vehicle out on a trip: photo, plate, driver, where to, and how long it has been out. */
function TripCard({ r, now }) {
  const overdue = r.flag === 'OVERDUE'
  const lateBy = overdue ? minutesSince(r.scheduled_return, now) : 0
  return (
    <article className={`flex min-h-0 gap-5 overflow-hidden rounded-3xl p-4 ring-1 ${overdue ? 'bg-danger/20 ring-red-400/60' : 'bg-gradient-to-br from-white/[0.09] to-white/[0.03] ring-white/10'}`}>
      <div className="relative w-56 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-brand/60 to-brand-dark/80">
        {r.vehicle_photo_url
          ? <img src={r.vehicle_photo_url} alt="" className="h-full w-full object-cover" />
          : <Car size={72} strokeWidth={1.25} className="absolute inset-0 m-auto text-white/40" aria-hidden="true" />}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2 text-center text-2xl font-bold tracking-wider">{r.plate_number}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-lg text-slate-400"><MapPin size={20} className="shrink-0 text-gold" aria-hidden="true" /> Going to</div>
            <div className="line-clamp-2 text-[28px] leading-tight font-bold" title={r.destination}>{r.destination}</div>
          </div>
          {overdue && <Pill className="shrink-0 bg-danger">Overdue</Pill>}
        </div>
        <div className="mt-auto flex items-center gap-3 pt-2">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-bold" aria-hidden="true">{initials(r.driver_name)}</span>
          <span className="min-w-0">
            <span className="block truncate text-xl font-semibold">{r.driver_name}</span>
            <span className="block truncate text-base text-slate-400">{r.vehicle_label}</span>
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-white/10 pt-3 tabular-nums">
          <Time label="Left" value={t(r.departed_at)} />
          <Time label="Out for" value={span(minutesSince(r.departed_at, now))} />
          {r.scheduled_return && (overdue
            ? <Time label="Late by" value={span(lateBy)} alert />
            : <Time label="Back by" value={t(r.scheduled_return)} />)}
        </dl>
      </div>
    </article>
  )
}

function Time({ label, value, alert }) {
  return (
    <div className="min-w-0">
      <dt className={`text-sm font-semibold tracking-wider uppercase ${alert ? 'text-red-200' : 'text-slate-400'}`}>{label}</dt>
      <dd className={`truncate text-[22px] leading-tight font-bold ${alert ? 'text-red-100' : ''}`}>{value}</dd>
    </div>
  )
}

function Stat({ icon: Icon, tone, value, label, pulse }) {
  return (
    <div className={`flex items-center gap-5 rounded-2xl bg-gradient-to-br px-6 py-4 ring-1 ${tone}`}>
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-black/20 ${pulse ? 'motion-safe:animate-pulse' : ''}`}>
        <Icon size={32} aria-hidden="true" />
      </span>
      <span>
        <span className="block text-5xl leading-none font-bold text-white tabular-nums">{value}</span>
        <span className="mt-1 block text-xl text-white/80">{label}</span>
      </span>
    </div>
  )
}

function SectionTitle({ icon: Icon, title, small, children }) {
  return (
    <h2 className={`mb-4 flex items-center gap-3 font-bold ${small ? 'text-3xl' : 'text-[34px]'}`}>
      <Icon size={small ? 28 : 32} className="text-gold" aria-hidden="true" />
      <span className="mr-auto">{title}</span>
      {children}
    </h2>
  )
}

const Placeholder = ({ children }) => <p className="text-2xl text-slate-400">{children}</p>

function Pill({ className, children }) {
  return <span className={`inline-block rounded-full px-4 py-1 text-lg font-bold text-white ${className}`}>{children}</span>
}

// Dark background: easier to read across a room and kinder to TV panels than a white page.
function Screen({ children }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 bg-[radial-gradient(ellipse_at_top_left,rgba(3,5,186,0.35),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(255,198,3,0.08),transparent_50%)] text-white">
      {children}
    </div>
  )
}
