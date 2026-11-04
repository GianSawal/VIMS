import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, Car, CircleCheck, Clock, ClipboardList, MapPin, MonitorOff, Navigation, TriangleAlert, UserRound, WifiOff } from 'lucide-react'
import { api } from '../../api'
import { initials } from '../../components/filters'

/*
 * Lobby TV trip board: /display?token=<screen token>. No staff login; the token is created in Django admin
 * (Operations > Display screens) and revoked by unticking "is active".
 *
 * Layout: header, a one-line summary bar, then active trips (left) beside the next 7 days and today's returns
 * (right). The API leaves cancelled trips out. Drawn on a fixed 1920x1080 stage scaled to the screen, so Full HD,
 * 4K and smaller TVs all show the same layout. Light theme: white panels on a pale gray page, DOLE blue accents.
 */

const W = 1920
const H = 1080
// Near real time: new, dispatched and returned trips appear within a few seconds. One cheap request per poll,
// well under the 'display' throttle (120/min per screen).
const REFRESH_MS = 5_000
const PAGE_MS = 12_000
const COMPLETED_SHOWN = 4
const FONT = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
const INK = '#0f172a' // plate lettering
const PAGE = '#eef2f7' // letterbox around the stage
const BACKDROP = 'linear-gradient(180deg, #ffffff 0%, #f4f6fa 40%, #eef2f7 100%)'
const panel = 'bg-white ring-1 ring-slate-200 shadow-[0_1px_2px_rgb(15_23_42/.04),0_4px_16px_rgb(15_23_42/.04)]'

const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const shortDay = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
const wk = new Intl.DateTimeFormat('en-PH', { weekday: 'short' })
const t = (v) => (v ? timeFmt.format(new Date(v)) : '')
const sameDay = (a, b) => a.toDateString() === b.toDateString()
/** Time, with the date in front when it isn't today (overnight trips). */
const when = (v, now) => (!v ? '' : sameDay(new Date(v), now) ? t(v) : `${shortDay.format(new Date(v))}, ${t(v)}`)

/** 135 -> "2h 15m", 50 -> "50 min", 1600 -> "1d 2h" */
function span(mins) {
  const m = Math.max(0, Math.round(mins))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
}
const minutes = (from, to) => (new Date(to) - new Date(from)) / 60_000

/** Status: label, pill classes, dot/bar color class. Late return = red, late departure = orange. */
function statusOf(r) {
  if (r.flag === 'OVERDUE') return ['Overdue', 'bg-red-50 text-red-700 ring-red-200', 'bg-red-500']
  if (r.flag === 'DELAYED') return ['Delayed', 'bg-orange-50 text-orange-700 ring-orange-200', 'bg-orange-500']
  if (r.status === 'DISPATCHED') return ['On the road', 'bg-sky-50 text-sky-700 ring-sky-200', 'bg-sky-500']
  return ['Scheduled', 'bg-amber-50 text-amber-700 ring-amber-200', 'bg-gold']
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

const FRESH_MS = 10 * 60_000 // how long a "Just left / Just returned / New booking" tag stays
const EASE = [0.23, 1, 0.32, 1]

/**
 * ticket -> time its status last changed between refreshes (not on the first load), so the board can point at
 * what just happened. Derived during render from the previous snapshot, no effect needed.
 */
function useChanges(data, now) {
  const [snap, setSnap] = useState({ data: undefined, status: null, at: {} })
  if (data && data !== snap.data) {
    const status = Object.fromEntries([...data.today, ...data.upcoming].map((r) => [r.ticket_number, r.status]))
    const at = { ...snap.at }
    if (snap.status) for (const [k, s] of Object.entries(status)) if (snap.status[k] !== s) at[k] = now.getTime()
    setSnap({ data, status, at })
  }
  return (ticket) => snap.at[ticket] != null && now.getTime() - snap.at[ticket] < FRESH_MS
}

const SHIFT = [[0, 0], [3, 2], [-2, 3], [-3, -2], [2, -3]]
const SHIFT_MS = 3 * 60_000
/** Burn-in protection: the stage drifts a few pixels every few minutes. Too small and slow to notice. */
function useDrift() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % SHIFT.length), SHIFT_MS)
    return () => clearInterval(id)
  }, [])
  return SHIFT[i]
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

function useStageScale() {
  const [scale, setScale] = useState(() => Math.min(window.innerWidth / W, window.innerHeight / H))
  useEffect(() => {
    const onResize = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return scale
}

/** Inter for the TV only; falls back to the system font when offline. */
function useFont() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT}"]`)) return
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONT }))
  }, [])
}

export default function TripDisplay() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const now = useClock()
  useFont()
  const q = useQuery({
    queryKey: ['display', token],
    queryFn: () => api.get('/display/trips/', { params: { token } }).then((r) => r.data),
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    retry: (n, err) => err?.response?.status !== 403,
    placeholderData: keepPreviousData, // keep the last board on screen while refreshing: no flicker
    enabled: !!token,
  })

  const fresh = useChanges(q.data, now)
  const rows = q.data?.today ?? []
  // On the road first (longest out first), then today's departures by time.
  const active = rows.filter((r) => r.status === 'DISPATCHED' || r.status === 'SCHEDULED')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'DISPATCHED' ? -1 : 1)
      || new Date(a.departed_at ?? a.scheduled_departure) - new Date(b.departed_at ?? b.scheduled_departure))
  const completed = rows.filter((r) => r.status === 'COMPLETED')
    .sort((a, b) => new Date(b.returned_at) - new Date(a.returned_at))
  const upcoming = q.data?.upcoming ?? []
  const onRoad = active.filter((r) => r.status === 'DISPATCHED').length
  const late = active.filter((r) => r.flag).length

  // Next 7 days grouped by day (the date shows once per day). Fewer rows fit when "Returned today" shares the column.
  const agendaRows = completed.length ? 3 : 5
  const agenda = []
  let agendaCount = 0
  for (const r of upcoming) {
    if (agendaCount >= agendaRows) break
    const key = new Date(r.scheduled_departure).toDateString()
    const last = agenda[agenda.length - 1]
    if (last && last.key === key) last.trips.push(r)
    else agenda.push({ key, date: new Date(r.scheduled_departure), trips: [r] })
    agendaCount++
  }

  // Compact cards: up to 3 stack in one column; 4 or more use a 2-column grid (3 rows) and page every PAGE_MS.
  const cols = active.length >= 4 ? 2 : 1
  const perPage = cols === 2 ? 6 : 3
  const [page, pages] = usePager(active.length, perPage)
  const shown = active.slice(page * perPage, (page + 1) * perPage)
  const offline = q.isError && !!q.data

  if (!token || q.error?.response?.status === 403) {
    return (
      <Stage>
        <div className="flex h-full items-center justify-center">
          <div className={`w-[900px] rounded-2xl p-16 text-center ${panel}`}>
            <MonitorOff size={64} strokeWidth={1.5} className="mx-auto text-slate-400" aria-hidden="true" />
            <p className="mt-8 text-[44px] font-bold text-slate-900">Display not set up</p>
            <p className="mt-4 text-2xl leading-relaxed text-slate-600">This display link is missing, invalid or has been turned off.<br />Ask the System Administrator for a new link.</p>
          </div>
        </div>
      </Stage>
    )
  }

  return (
    <Stage>
      <style>{`@keyframes vrs-page { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        @keyframes vrs-glow { 0%, 100% { outline-color: transparent } 30%, 60% { outline-color: var(--color-gold) } }
        @media (prefers-reduced-motion: reduce) { * { animation-iteration-count: 1 !important } }`}</style>

      {/* Header: identity on the left, clock on the right */}
      <header className="flex h-[128px] shrink-0 items-center gap-6 px-14">
        <img src="/dole-emblem.png" alt="DOLE emblem" className="h-[76px] w-[76px] shrink-0 object-contain" />
        <div className="mr-auto min-w-0">
          <div className="text-[14px] font-semibold tracking-[0.24em] text-brand uppercase">Department of Labor and Employment</div>
          <div className="mt-2 flex items-baseline gap-5">
            <h1 className="text-[42px] leading-none font-extrabold tracking-tight text-slate-900">Vehicle Trip Board</h1>
            <span className="h-8 w-px self-center bg-slate-300" aria-hidden="true" />
            <span className="truncate text-[24px] font-medium text-slate-600">{q.data?.office?.name ?? 'DOLE Region III'}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[60px] leading-none font-bold tracking-tight text-slate-900 tabular-nums">{timeFmt.format(now)}</div>
          <div className="mt-2 text-[18px] font-medium text-slate-600">{dayFmt.format(now)}</div>
        </div>
      </header>
      <div className="mx-14 h-px shrink-0 bg-slate-100" aria-hidden="true" />

      {offline && (
        <div role="status" className="mx-14 mt-4 flex shrink-0 items-center gap-3 rounded-xl bg-amber-50 px-6 py-3 text-[20px] font-medium text-amber-800 ring-1 ring-amber-200">
          <WifiOff size={22} aria-hidden="true" /> Connection lost. Showing the board as of {t(q.data.generated_at)}; it updates again when the connection returns.
        </div>
      )}

      {/* Today at a glance: one bar, four figures */}
      <dl className={`mx-14 mt-6 grid shrink-0 grid-cols-4 divide-x divide-slate-200 overflow-hidden rounded-2xl ${panel}`} aria-label="Today">
        <Stat icon={Navigation} label="On the road" value={onRoad} color="text-sky-600" />
        <Stat icon={Clock} label="Leaving later" value={active.length - onRoad} color="text-amber-500" />
        <Stat icon={CircleCheck} label="Returned today" value={completed.length} color="text-emerald-600" />
        <Stat icon={TriangleAlert} label="Running late" value={late} color={late ? 'text-red-600' : 'text-slate-400'} alert={late > 0} />
      </dl>

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_520px] gap-8 px-14 py-6">
        {/* Active trips */}
        <section className="flex min-h-0 flex-col" aria-labelledby="active-title">
          <div className="mb-4 flex items-center gap-4">
            <h2 id="active-title" className="text-[26px] font-bold tracking-tight text-slate-900">Active Trips</h2>
            <span className="rounded-md bg-slate-100 px-2.5 py-0.5 text-[17px] font-bold text-slate-900 tabular-nums">{active.length}</span>
            {pages > 1 && (
              <span className="ml-auto flex items-center gap-2" aria-label={`Page ${page + 1} of ${pages}`}>
                {Array.from({ length: pages }, (_, i) => <span key={i} className={`h-2 rounded-full transition-all duration-300 ${i === page ? 'w-8 bg-gold' : 'w-2 bg-slate-300'}`} />)}
              </span>
            )}
          </div>

          {q.isLoading ? (
            <div className="space-y-5">
              {[...Array(3)].map((_, i) => <div key={i} className={`h-[200px] rounded-2xl motion-safe:animate-pulse ${panel}`} />)}
            </div>
          ) : active.length === 0 ? (
            <Empty next={upcoming[0]} now={now} />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={page} className={`grid items-start gap-5 ${cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}>
                {shown.map((r) => <TripCard key={r.ticket_number} r={r} now={now} wide={cols === 1} fresh={fresh(r.ticket_number)} />)}
              </motion.div>
            </AnimatePresence>
          )}

          {pages > 1 && (
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div key={page} className="h-full origin-left bg-gold/70" style={{ animation: `vrs-page ${PAGE_MS}ms linear` }} />
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-6">
          <section className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl ${panel}`} aria-labelledby="next-title">
            <PanelHead id="next-title" icon={CalendarDays} iconColor="text-brand" title="Next 7 Days" count={`${upcoming.length} booked`} />
            {upcoming.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-[20px] font-medium text-slate-500">No upcoming bookings</div>
            ) : (
              <div className="min-h-0 overflow-hidden pb-2">
                {agenda.map((g) => <AgendaDay key={g.key} g={g} now={now} fresh={fresh} />)}
                {upcoming.length > agendaCount && <div className="border-t border-slate-100 px-6 pt-3 text-[16px] font-medium text-slate-500">+{upcoming.length - agendaCount} more this week</div>}
              </div>
            )}
          </section>

          {completed.length > 0 && <CompletedToday trips={completed} now={now} fresh={fresh} />}
        </aside>
      </main>

      <footer className="mx-14 flex h-[48px] shrink-0 items-center justify-end border-t border-slate-200 text-[16px] text-slate-500">
        <span className="flex items-center gap-2.5 tabular-nums">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            {!offline && q.data && <span className="absolute inset-0 rounded-full bg-emerald-500 motion-safe:animate-ping" />}
            <span className={`relative h-2.5 w-2.5 rounded-full ${offline || !q.data ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          </span>
          {offline ? 'Reconnecting…' : q.data ? `Updated ${t(q.data.generated_at)}` : 'Connecting…'}
        </span>
      </footer>
    </Stage>
  )
}

/**
 * Compact horizontal trip card: vehicle photo, then plate / model / status, destination, purpose, and a footer
 * with the driver and the departure time. Same size whether one trip or many are showing; `wide` (single
 * column) adds the expected-return time, which is cut in the 2-column grid to keep rows short.
 */
const FRESH_TAG = { DISPATCHED: 'Just left', COMPLETED: 'Just returned', SCHEDULED: 'New booking' }
// Gold outline that pulses three times when a trip just changed (replays when its page rotates back in).
const glow = (on, inset) => (on ? { outline: '4px solid transparent', outlineOffset: inset ? -4 : 2, animation: 'vrs-glow 2s ease-in-out 3' } : undefined)

function FreshTag({ r, className = 'px-3 py-1 text-[15px]' }) {
  return (
    <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: EASE }}
      className={`inline-flex shrink-0 items-center rounded-full bg-gold font-bold text-slate-900 ${className}`}>
      {FRESH_TAG[r.status]}
    </motion.span>
  )
}

function TripCard({ r, now, wide, fresh }) {
  const [label, pill, dot] = statusOf(r)
  const out = r.status === 'DISPATCHED'
  const late = !!r.flag
  const [verb, time] = out ? ['Departed', r.departed_at] : ['Departs', r.scheduled_departure]
  const leavesIn = minutes(now, r.scheduled_departure)
  const sub = out
    ? (r.flag === 'OVERDUE' ? `${span(minutes(r.scheduled_return, now))} overdue` : `On the road ${span(minutes(r.departed_at, now))}`)
    : (r.flag === 'DELAYED' ? `${span(-leavesIn)} past schedule` : leavesIn <= 1 ? 'Leaving now' : `Leaves in ${span(leavesIn)}`)
  const back = wide && r.scheduled_return && r.flag !== 'OVERDUE' ? `${out ? 'Back' : 'Back by'} ${when(r.scheduled_return, now)}` : null
  const progress = out && r.scheduled_return
    ? Math.min(1, Math.max(0, minutes(r.departed_at, now) / Math.max(1, minutes(r.departed_at, r.scheduled_return)))) : null
  const subColor = late ? 'font-semibold text-red-600' : out ? 'text-slate-500' : 'font-semibold text-amber-700'

  return (
    <article style={glow(fresh)} className={`relative flex min-w-0 gap-4 overflow-hidden rounded-2xl p-3 pl-4 ${late ? 'bg-red-50 ring-1 ring-red-300' : panel}`}>
      <span className={`absolute inset-y-0 left-0 w-1.5 ${dot}`} aria-hidden="true" />
      <VehicleImage r={r} className={wide ? 'w-[210px]' : 'w-[160px]'} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1 pr-1">
        <div className="flex min-w-0 items-center gap-3">
          <Plate size="md">{r.plate_number}</Plate>
          <span className="min-w-0 truncate text-[16px] text-slate-500">{r.vehicle_label}</span>
          {fresh && <FreshTag r={r} className="ml-auto px-3 py-1 text-[15px]" />}
          <span className={`${fresh ? '' : 'ml-auto'} inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[15px] font-semibold ring-1 ${pill}`}>
            <span className="relative flex h-2 w-2" aria-hidden="true">
              {out && !late && <span className={`absolute inset-0 rounded-full ${dot} motion-safe:animate-ping`} />}
              <span className={`relative h-2 w-2 rounded-full ${dot}`} />
            </span>
            {label}
          </span>
        </div>

        <div className="mt-1 flex min-w-0 items-center gap-2" title={r.destination}>
          <MapPin size={22} className="shrink-0 text-brand" aria-hidden="true" />
          <p className="truncate text-[25px] leading-tight font-bold tracking-tight text-slate-900">{r.destination}</p>
        </div>
        {r.purpose && (
          <p className="flex min-w-0 items-center gap-2 text-[16px]" title={r.purpose}>
            <ClipboardList size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate font-medium text-slate-600">{r.purpose}</span>
          </p>
        )}

        <div className="mt-auto flex items-center gap-3 border-t border-slate-200 pt-2.5">
          <Avatar name={r.driver_name} src={r.driver_photo_url} size={36} />
          <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-slate-800" title={r.driver_name ?? 'Driver TBA'}>{r.driver_name ?? 'Driver TBA'}</span>
          <div className="shrink-0 text-right">
            <div className="flex items-baseline justify-end gap-2">
              <span className="text-[12px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
                {verb}{!sameDay(new Date(time), now) && ` · ${shortDay.format(new Date(time))}`}
              </span>
              <span className={`text-[28px] leading-none font-bold tracking-tight tabular-nums ${late ? 'text-red-600' : 'text-slate-900'}`}>{t(time)}</span>
            </div>
            <div className={`mt-1 text-[14px] whitespace-nowrap ${subColor}`}>
              {sub}{back && <span className="font-normal text-slate-500"> · {back}</span>}
            </div>
          </div>
        </div>
      </div>

      {progress != null && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-slate-100" aria-hidden="true">
          <span className={`block h-full transition-[width] duration-1000 ease-linear ${dot}`} style={{ width: `${progress * 100}%` }} />
        </span>
      )}
    </article>
  )
}

/** Panel title row with an icon, title and a count on the right. */
function PanelHead({ id, icon: Icon, iconColor, title, count }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-6 py-4">
      <Icon size={22} className={iconColor} aria-hidden="true" />
      <h2 id={id} className="text-[21px] font-bold tracking-tight text-slate-900">{title}</h2>
      <span className="ml-auto text-[16px] font-medium text-slate-500 tabular-nums">{count}</span>
    </div>
  )
}

/** Trips completed today: a compact list in the side column. Plate · destination · return time. */
// List rows that arrive between refreshes slide in (not on first paint: AnimatePresence initial={false}).
const rowMotion = { layout: 'position', initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0 }, transition: { duration: 0.5, ease: EASE } }

function CompletedToday({ trips, now, fresh }) {
  return (
    <section className={`shrink-0 overflow-hidden rounded-2xl ${panel}`} aria-labelledby="done-title">
      <PanelHead id="done-title" icon={CircleCheck} iconColor="text-emerald-600" title="Returned Today" count={trips.length} />
      <ul>
        <AnimatePresence initial={false}>
          {trips.slice(0, COMPLETED_SHOWN).map((r) => (
            <motion.li key={r.ticket_number} {...rowMotion} style={glow(fresh(r.ticket_number), true)}
              className="flex items-center gap-4 border-t border-slate-100 px-6 py-2.5 first:border-t-0">
              <Thumb r={r} className="h-[48px] w-[68px]" />
              <Plate>{r.plate_number}</Plate>
              <span className="min-w-0 flex-1 truncate text-[17px] text-slate-700" title={r.destination}>{r.destination}</span>
              {fresh(r.ticket_number) && <FreshTag r={r} className="px-2.5 py-0.5 text-[14px]" />}
              <span className="shrink-0 text-[17px] font-semibold text-emerald-600 tabular-nums">{when(r.returned_at, now)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {trips.length > COMPLETED_SHOWN && (
        <div className="border-t border-slate-100 px-6 py-2.5 text-[16px] font-medium text-slate-500">+{trips.length - COMPLETED_SHOWN} more returned today</div>
      )}
    </section>
  )
}

/** Small fixed-size vehicle photo for list rows; a car icon when the vehicle has no photo. */
function Thumb({ r, className }) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-lg bg-gradient-to-b from-slate-50 to-slate-100 ring-1 ring-slate-200 ${className}`}>
      {r.vehicle_photo_url
        ? <img src={r.vehicle_photo_url} alt={`${r.vehicle_label ?? ''} ${r.plate_number}`.trim()} className="h-full w-full object-contain p-1.5 mix-blend-multiply" />
        : <div className="flex h-full items-center justify-center text-slate-400"><Car size={28} strokeWidth={1.5} aria-hidden="true" /></div>}
    </div>
  )
}

/** Whole vehicle photo, fitted (not cropped) on a light tile; multiply blends the photo's white background in. */
function VehicleImage({ r, className }) {
  return (
    <div className={`shrink-0 self-stretch overflow-hidden rounded-xl bg-gradient-to-b from-slate-50 to-slate-100 ring-1 ring-slate-200 ${className}`}>
      {r.vehicle_photo_url
        ? <img src={r.vehicle_photo_url} alt={`${r.vehicle_label} ${r.plate_number}`} className="h-full w-full object-contain p-3 mix-blend-multiply" />
        : (
          <div className="flex h-full flex-col items-center justify-center text-slate-400">
            <Car size={56} strokeWidth={1.25} aria-hidden="true" />
            <span className="mt-1 text-[15px] font-medium text-slate-500">{r.vehicle_label}</span>
          </div>
        )}
    </div>
  )
}

/** Driver photo, initials, or a neutral person icon when no driver is assigned yet. */
function Avatar({ name, src, size }) {
  const style = { width: size, height: size }
  if (src) return <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover ring-2 ring-slate-200" />
  return (
    <span style={{ ...style, fontSize: size * 0.36 }} className="flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-800 ring-1 ring-slate-200" aria-hidden="true">
      {name ? initials(name) : <UserRound size={size * 0.5} className="text-slate-500" />}
    </span>
  )
}

/** Plate tag: white plate with a thin border, dark letters, spaced like a real plate. */
const PLATE_SIZES = { sm: 'rounded-md px-2 text-[15px] leading-7', md: 'rounded-lg px-3 py-0.5 text-[24px] leading-tight' }
function Plate({ children, size = 'sm' }) {
  return (
    <span className={`inline-block shrink-0 bg-white font-extrabold ring-1 ring-slate-300 tracking-[0.1em] whitespace-nowrap ${PLATE_SIZES[size]}`} style={{ color: INK }}>
      {children}
    </span>
  )
}

function Stat({ icon: Icon, label, value, color, alert }) {
  return (
    <div className={`flex items-center gap-5 px-8 py-5 ${alert ? 'bg-red-50' : ''}`}>
      {/* dt before dd for screen readers; the number is shown first. */}
      <dt className="order-last flex items-center gap-2.5 text-[19px] font-medium text-slate-600">
        <Icon size={22} className={color} aria-hidden="true" />{label}
      </dt>
      {/* The number rolls: the old one slides up and out, the new one comes in from below. */}
      <dd className={`relative overflow-hidden text-[52px] leading-none font-bold tracking-tight tabular-nums ${alert ? 'text-red-600' : 'text-slate-900'}`}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} className="block" initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-100%', opacity: 0 }} transition={{ duration: 0.5, ease: EASE }}>{value}</motion.span>
        </AnimatePresence>
      </dd>
    </div>
  )
}

/** A day's worth of upcoming trips: a slim day header (date shown once), then rows of time · plate · destination. */
function AgendaDay({ g, now, fresh }) {
  const tomorrow = sameDay(g.date, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  return (
    <div>
      <div className="flex items-center gap-2.5 bg-slate-50 px-6 py-2">
        <span className={`text-[14px] font-bold tracking-[0.12em] uppercase ${tomorrow ? 'text-brand' : 'text-slate-700'}`}>{tomorrow ? 'Tomorrow' : wk.format(g.date)}</span>
        <span className="text-[14px] font-medium text-slate-500">{shortDay.format(g.date)}</span>
        {g.trips.length > 1 && <span className="ml-auto text-[14px] font-medium text-slate-400 tabular-nums">{g.trips.length} trips</span>}
      </div>
      <ul>
        <AnimatePresence initial={false}>
        {g.trips.map((r) => (
          <motion.li key={r.ticket_number} {...rowMotion} style={glow(fresh(r.ticket_number), true)}
            className="flex items-center gap-4 border-t border-slate-100 px-6 py-3 first:border-t-0">
            <Thumb r={r} className="h-[72px] w-[104px]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <span className="text-[19px] font-bold text-slate-900 tabular-nums">{t(r.scheduled_departure)}</span>
                <Plate>{r.plate_number}</Plate>
                {fresh(r.ticket_number) && <FreshTag r={r} className="ml-auto px-2.5 py-0.5 text-[14px]" />}
              </div>
              <div className="mt-1 truncate text-[18px] font-semibold text-slate-800" title={r.destination}>{r.destination}</div>
              <div className="mt-0.5 truncate text-[15px] text-slate-500" title={r.purpose}>
                {[r.purpose, r.driver_name].filter(Boolean).join(' · ') || 'Driver to be assigned'}
              </div>
            </div>
          </motion.li>
        ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}

function Empty({ next, now }) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center rounded-2xl px-12 text-center ${panel}`}>
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
        <CircleCheck size={40} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="mt-7 text-[38px] font-bold tracking-tight text-slate-900">All vehicles are at the motor pool</p>
      {next && (
        <div className="mt-12 w-full max-w-[880px] border-t border-slate-200 pt-8">
          <div className="text-[14px] font-semibold tracking-[0.18em] text-slate-500 uppercase">Next trip</div>
          <div className="mt-4 text-[28px] font-bold text-slate-900 tabular-nums">{wk.format(new Date(next.scheduled_departure))}, {when(next.scheduled_departure, now)}</div>
          <div className="mt-3 flex items-center justify-center gap-4">
            <Plate size="md">{next.plate_number}</Plate>
            <span className="max-w-[420px] truncate text-[24px] font-medium text-slate-700" title={next.destination}>{next.destination}</span>
          </div>
          {next.vehicle_label && <div className="mt-2 text-[18px] text-slate-500">{next.vehicle_label}</div>}
        </div>
      )}
    </div>
  )
}

/** Fixed 1920x1080 canvas scaled to the screen (letterboxed in navy if the TV isn't 16:9). A thin DOLE tricolor tops it. */
// Live background: soft glows in the logo colors drifting behind the panels, one cycle a minute or more.
// Radial gradients moved with transform only (no CSS blur), so weak TV browsers keep up. [color, size, left, top, seconds, path]
const GLOWS = [
  ['rgb(3 5 186 / .10)', 1100, -250, -350, 47, 'a'],
  ['rgb(255 198 3 / .16)', 900, 1250, 350, 61, 'b'],
  ['rgb(3 5 186 / .08)', 1000, 700, 600, 73, 'c'],
  ['rgb(255 1 3 / .05)', 800, 1400, -300, 53, 'a'],
]
const GLOW_CSS = `
  @keyframes vrs-a { to { transform: translate(260px, 160px) scale(1.15) } }
  @keyframes vrs-b { to { transform: translate(-320px, -140px) scale(.9) } }
  @keyframes vrs-c { to { transform: translate(-200px, -220px) scale(1.1) } }
  @media (prefers-reduced-motion: reduce) { .vrs-glows > span { animation: none !important } }`

function Stage({ children }) {
  const scale = useStageScale()
  const [dx, dy] = useDrift()
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: PAGE }}>
      <div className="isolate absolute top-1/2 left-1/2 flex flex-col overflow-hidden font-['Inter',ui-sans-serif,system-ui,'Segoe_UI',sans-serif] antialiased transition-transform duration-[2000ms] ease-in-out"
        style={{ width: W, height: H, background: BACKDROP, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})` }}>
        <style>{GLOW_CSS}</style>
        <div className="vrs-glows pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          {GLOWS.map(([color, size, left, top, s, path]) => (
            <span key={`${left},${top}`} className="absolute rounded-full will-change-transform"
              style={{ width: size, height: size, left, top, background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
                       animation: `vrs-${path} ${s}s ease-in-out infinite alternate` }} />
          ))}
        </div>
        <div className="flex h-1 shrink-0" aria-hidden="true">
          <span className="flex-1 bg-brand" /><span className="flex-1 bg-accent" /><span className="flex-1 bg-gold" />
        </div>
        {children}
      </div>
    </div>
  )
}
