import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, Car, CircleCheck, Clock, ClipboardList, MapPin, MonitorOff, Navigation, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react'
import { api } from '../../api'
import { initials } from '../../components/filters'

/*
 * Lobby TV trip board: /display?token=<screen token>. No staff login; the token is created in Django admin
 * (Operations > Display screens) and revoked by unticking "is active".
 *
 * Shows vehicles on the road now, today's bookings not yet gone, and a subordinate "Completed today" strip
 * (the API leaves cancelled trips out). Drawn on a fixed 1920x1080 stage scaled to the screen, so Full HD,
 * 4K and smaller TVs all show the same layout. Dark theme: less glare in a lit lobby and readable from afar.
 */

const W = 1920
const H = 1080
const REFRESH_MS = 60_000
const PAGE_MS = 12_000
const AGENDA_ROWS = 4
const COMPLETED_SHOWN = 6
const FONT = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
const NAVY = '#060a24'
const BACKDROP = `radial-gradient(1100px 620px at 8% -12%, rgb(3 5 186 / .55), transparent 70%),
  radial-gradient(900px 520px at 105% 115%, rgb(255 198 3 / .10), transparent 70%), ${NAVY}`
const glass = 'bg-white/[0.055] ring-1 ring-white/10 shadow-[inset_0_1px_0_rgb(255_255_255/.06)]'

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
  if (r.flag === 'OVERDUE') return ['Overdue', 'bg-red-500/15 text-red-300 ring-red-400/40', 'bg-red-400']
  if (r.flag === 'DELAYED') return ['Delayed', 'bg-orange-500/15 text-orange-300 ring-orange-400/40', 'bg-orange-400']
  if (r.status === 'DISPATCHED') return ['On the road', 'bg-sky-400/15 text-sky-200 ring-sky-400/40', 'bg-sky-400']
  return ['Scheduled', 'bg-gold/15 text-gold ring-gold/40', 'bg-gold']
}

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

  // Next 7 days grouped by day (so the date shows once per day, not on every row), capped to AGENDA_ROWS trips.
  const agenda = []
  let agendaCount = 0
  for (const r of upcoming) {
    if (agendaCount >= AGENDA_ROWS) break
    const key = new Date(r.scheduled_departure).toDateString()
    const last = agenda[agenda.length - 1]
    if (last && last.key === key) last.trips.push(r)
    else agenda.push({ key, date: new Date(r.scheduled_departure), trips: [r] })
    agendaCount++
  }

  // Content-driven layout: one trip is a wide featured card; a few stack; many use a 2-column grid and page.
  const featured = active.length === 1
  const cols = active.length >= 4 ? 2 : 1
  const perPage = featured ? 1 : cols === 2 ? 4 : 3
  const [page, pages] = usePager(active.length, perPage)
  const shown = active.slice(page * perPage, (page + 1) * perPage)
  const offline = q.isError && !!q.data

  if (!token || q.error?.response?.status === 403) {
    return (
      <Stage>
        <div className="flex h-full items-center justify-center">
          <div className={`w-[900px] rounded-[32px] p-16 text-center ${glass}`}>
            <MonitorOff size={64} strokeWidth={1.5} className="mx-auto text-white/40" aria-hidden="true" />
            <p className="mt-8 text-[44px] font-bold text-white">Display not set up</p>
            <p className="mt-4 text-2xl leading-relaxed text-white/60">This display link is missing, invalid or has been turned off.<br />Ask the System Administrator for a new link.</p>
          </div>
        </div>
      </Stage>
    )
  }

  return (
    <Stage>
      <style>{'@keyframes vrs-page { from { transform: scaleX(0) } to { transform: scaleX(1) } }'}</style>

      <header className="flex h-[124px] shrink-0 items-center gap-6 px-14">
        <img src="/dole-emblem.png" alt="DOLE emblem" className="h-[76px] w-[76px] rounded-full bg-white p-1 shadow-[0_0_0_6px_rgb(255_255_255/.06)]" />
        <div className="mr-auto">
          <div className="text-[15px] font-semibold tracking-[0.24em] text-gold uppercase">Department of Labor and Employment</div>
          <div className="mt-1.5 flex items-center gap-4">
            <h1 className="text-[44px] leading-none font-extrabold tracking-tight text-white">Vehicle Trip Board</h1>
            <span className="rounded-full bg-white/[0.08] px-4 py-1.5 text-[20px] font-medium text-white/75 ring-1 ring-white/10">{q.data?.office?.name ?? 'DOLE Region III'}</span>
          </div>
        </div>
        <span className={`flex items-center gap-2.5 rounded-full px-4 py-2 text-[17px] font-semibold ring-1 ${offline ? 'bg-amber-400/10 text-amber-300 ring-amber-400/30' : 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30'}`}>
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            {!offline && <span className="absolute inset-0 rounded-full bg-emerald-400 motion-safe:animate-ping" />}
            <span className={`relative h-2.5 w-2.5 rounded-full ${offline ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          </span>
          {offline ? 'Reconnecting' : 'Live'}
        </span>
        <div className="ml-4 text-right">
          <div className="text-[60px] leading-none font-bold tracking-tight text-white tabular-nums">{timeFmt.format(now)}</div>
          <div className="mt-2 text-[18px] font-medium text-white/55">{dayFmt.format(now)}</div>
        </div>
      </header>
      <div className="mx-14 h-px shrink-0 bg-gradient-to-r from-gold/70 via-white/15 to-transparent" aria-hidden="true" />

      {offline && (
        <div role="status" className="mx-14 mt-4 flex shrink-0 items-center gap-3 rounded-2xl bg-amber-400/10 px-6 py-3 text-[20px] font-medium text-amber-200 ring-1 ring-amber-400/30">
          <WifiOff size={22} aria-hidden="true" /> Connection lost. Showing the board as of {t(q.data.generated_at)}; it updates again when the connection returns.
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_500px] gap-8 px-14 py-7">
        {/* Active trips + completed strip */}
        <section className="flex min-h-0 flex-col" aria-labelledby="active-title">
          <div className="mb-5 flex items-center gap-4">
            <h2 id="active-title" className="text-[30px] font-bold tracking-tight text-white">Active Trips</h2>
            <span className="rounded-full bg-white/10 px-3.5 py-0.5 text-[18px] font-bold text-white tabular-nums">{active.length}</span>
            <span className="text-[19px] font-medium text-white/45">On the road and leaving today</span>
            {pages > 1 && (
              <span className="ml-auto flex items-center gap-2" aria-label={`Page ${page + 1} of ${pages}`}>
                {Array.from({ length: pages }, (_, i) => <span key={i} className={`h-2 rounded-full transition-all duration-300 ${i === page ? 'w-8 bg-gold' : 'w-2 bg-white/25'}`} />)}
              </span>
            )}
          </div>

          {q.isLoading ? (
            <div className="space-y-5">
              {[...Array(3)].map((_, i) => <div key={i} className={`h-[200px] rounded-[28px] motion-safe:animate-pulse ${glass}`} />)}
            </div>
          ) : active.length === 0 ? (
            <Empty next={upcoming[0]} now={now} />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={page} className={`grid items-start gap-5 ${cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}>
                {shown.map((r) => <TripCard key={r.ticket_number} r={r} now={now} featured={featured} wide={cols === 1} />)}
              </motion.div>
            </AnimatePresence>
          )}

          {pages > 1 && (
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <div key={page} className="h-full origin-left bg-gold/70" style={{ animation: `vrs-page ${PAGE_MS}ms linear` }} />
            </div>
          )}

          {completed.length > 0 && <CompletedToday trips={completed} now={now} />}
        </section>

        <aside className="flex min-h-0 flex-col gap-6">
          <section aria-labelledby="today-title">
            <h2 id="today-title" className="mb-3 text-[22px] font-bold tracking-tight text-white">Today</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Stat icon={Navigation} label="On the road" value={onRoad} tone="text-sky-300 bg-sky-400/15" />
              <Stat icon={Clock} label="Leaving later" value={active.length - onRoad} tone="text-gold bg-gold/15" />
              <Stat icon={CircleCheck} label="Returned" value={completed.length} tone="text-emerald-300 bg-emerald-400/15" />
              <Stat icon={TriangleAlert} label="Running late" value={late} tone={late ? 'text-red-300 bg-red-500/20' : 'text-white/40 bg-white/10'} alert={late > 0} />
            </dl>
          </section>

          <section className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] ${glass}`} aria-labelledby="next-title">
            <div className="flex items-center gap-3 px-6 pt-6 pb-3">
              <CalendarDays size={24} className="text-gold" aria-hidden="true" />
              <h2 id="next-title" className="text-[22px] font-bold tracking-tight text-white">Next 7 Days</h2>
              <span className="ml-auto rounded-full bg-white/10 px-3 py-0.5 text-[16px] font-semibold text-white/75 tabular-nums">{upcoming.length} booked</span>
            </div>
            {upcoming.length === 0 ? (
              <div className="mx-6 mb-6 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 py-10 text-center">
                <CalendarDays size={40} strokeWidth={1.5} className="text-white/25" aria-hidden="true" />
                <p className="mt-3 text-[21px] font-semibold text-white/80">No upcoming bookings</p>
                <p className="mt-1 text-[16px] text-white/45">New schedules appear here automatically.</p>
              </div>
            ) : (
              <div className="overflow-hidden px-3 pb-3">
                {agenda.map((g) => <AgendaDay key={g.key} g={g} now={now} />)}
                {upcoming.length > agendaCount && <div className="px-3 pt-2.5 text-[17px] font-medium text-white/50">+{upcoming.length - agendaCount} more this week</div>}
              </div>
            )}
          </section>
        </aside>
      </main>

      <footer className="mx-14 flex h-12 shrink-0 items-center gap-6 border-t border-white/10 text-[16px] text-white/45">
        <span className="font-semibold text-white/75">{q.data?.screen ?? 'Lobby TV'}</span>
        <span className="h-4 w-px bg-white/15" aria-hidden="true" />
        <span className="mr-auto">For trip changes, please coordinate with the Fleet Administrator.</span>
        <span className="flex items-center gap-2 tabular-nums">
          <RefreshCw size={15} aria-hidden="true" />
          {q.data ? `Updated ${t(q.data.generated_at)} · refreshes every minute` : 'Connecting…'}
        </span>
      </footer>
    </Stage>
  )
}

/**
 * Horizontal trip card: vehicle image, then plate / model, status, destination (wraps), purpose, and driver +
 * departure time. `featured` = the single-trip hero (bigger image and type). Height is driven by content;
 * cards are never stretched to fill the board.
 */
function TripCard({ r, now, featured, wide }) {
  const [label, pill, dot] = statusOf(r)
  const out = r.status === 'DISPATCHED'
  const late = !!r.flag
  const [verb, time] = out ? ['Departed', r.departed_at] : ['Departs', r.scheduled_departure]
  const sub = out
    ? (r.flag === 'OVERDUE' ? `${span(minutes(r.scheduled_return, now))} overdue` : `On the road ${span(minutes(r.departed_at, now))}`)
    : (r.flag === 'DELAYED' ? `${span(minutes(r.scheduled_departure, now))} past schedule` : `Leaves in ${span(minutes(now, r.scheduled_departure))}`)
  const back = r.scheduled_return && r.flag !== 'OVERDUE' ? `${out ? 'Expected back' : 'Back by'} ${when(r.scheduled_return, now)}` : null
  const progress = out && r.scheduled_return
    ? Math.min(1, Math.max(0, minutes(r.departed_at, now) / Math.max(1, minutes(r.departed_at, r.scheduled_return)))) : null
  // On-time scheduled trips get a clear countdown pill instead of a plain "leaves in" line.
  const countdown = !out && !late ? (minutes(now, r.scheduled_departure) <= 1 ? 'Leaving now' : `Leaves in ${span(minutes(now, r.scheduled_departure))}`) : null
  const timeColor = late ? 'text-red-300' : 'text-white'

  return (
    <article className={`relative flex min-w-0 gap-5 overflow-hidden rounded-[28px] p-3 ${glass} ${late ? 'ring-red-400/50' : ''}`}>
      <VehicleImage r={r} className={featured ? 'w-[380px]' : 'w-[230px]'} />

      <div className={`flex min-w-0 flex-1 flex-col ${featured ? 'gap-4 py-4 pr-5' : 'gap-2.5 py-2 pr-3'}`}>
        {/* Plate + model, status */}
        <div className="flex items-start gap-4">
          <div className="min-w-0">
            <Plate big={featured}>{r.plate_number}</Plate>
            <div className={`mt-2 text-white/55 ${featured ? 'text-[22px]' : 'text-[18px]'}`}>{r.vehicle_label}</div>
          </div>
          <span className={`ml-auto inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 font-semibold ring-1 ${pill} ${featured ? 'text-[19px]' : 'text-[17px]'}`}>
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              {out && !late && <span className={`absolute inset-0 rounded-full ${dot} motion-safe:animate-ping`} />}
              <span className={`relative h-2.5 w-2.5 rounded-full ${dot}`} />
            </span>
            {label}
          </span>
        </div>

        {/* Destination (hero, wraps) and purpose (why the trip is made) */}
        <div className="flex min-w-0 items-start gap-2.5">
          <MapPin size={featured ? 32 : 26} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
          <p className={`leading-[1.12] font-bold tracking-tight text-white ${featured ? 'line-clamp-3 text-[42px]' : 'line-clamp-2 text-[28px]'}`}>{r.destination}</p>
        </div>
        {r.purpose && (
          <p className={`flex min-w-0 items-start gap-2.5 leading-snug ${featured ? 'text-[22px]' : 'text-[18px]'}`} title={r.purpose}>
            <ClipboardList size={featured ? 24 : 20} className="mt-0.5 shrink-0 text-white/40" aria-hidden="true" />
            <span className={featured ? 'line-clamp-2' : 'line-clamp-1'}>
              <span className="font-semibold tracking-[0.08em] text-white/40 uppercase">Purpose </span>
              <span className="font-medium text-white/80">{r.purpose}</span>
            </span>
          </p>
        )}

        {/* Driver + departure time. Wide cards place them on one row; narrow (2-col) cards stack them so
            driver names and times never get squeezed. */}
        {wide ? (
          <div className="mt-auto flex items-end gap-4 border-t border-white/10 pt-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={r.driver_name} src={r.driver_photo_url} size={featured ? 56 : 46} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold tracking-[0.12em] text-white/40 uppercase">Driver</div>
                <div className={`font-semibold text-white/90 ${featured ? 'text-[24px]' : 'text-[20px]'}`}>{r.driver_name}</div>
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-[13px] font-semibold tracking-[0.12em] text-white/40 uppercase">
                {verb}{!sameDay(new Date(time), now) && <span className="text-white/70"> · {shortDay.format(new Date(time))}</span>}
              </div>
              <div className={`leading-none font-bold tracking-tight whitespace-nowrap tabular-nums ${featured ? 'text-[48px]' : 'text-[38px]'} ${timeColor}`}>{t(time)}</div>
              {countdown ? (
                <div className="mt-2 flex flex-col items-end gap-1">
                  <span className={`inline-flex items-center gap-1.5 rounded-full bg-gold/15 font-semibold text-gold ring-1 ring-gold/40 ${featured ? 'px-3.5 py-1 text-[18px]' : 'px-3 py-0.5 text-[15px]'}`}><Clock size={featured ? 18 : 14} aria-hidden="true" /> {countdown}</span>
                  {back && <span className={`text-white/45 ${featured ? 'text-[16px]' : 'text-[14px]'}`}>{back}</span>}
                </div>
              ) : (
                <div className={`mt-1.5 whitespace-nowrap ${featured ? 'text-[18px]' : 'text-[16px]'} ${late ? 'font-semibold text-red-300' : 'text-white/55'}`}>{sub}{back && !late ? ` · ${back}` : ''}</div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-2 border-t border-white/10 pt-3">
            <div className="flex items-center gap-2.5">
              <Avatar name={r.driver_name} src={r.driver_photo_url} size={40} />
              <span className="min-w-0 flex-1 truncate text-[19px] font-semibold text-white/90" title={r.driver_name}>{r.driver_name}</span>
            </div>
            <div className="mt-2.5 flex items-center gap-2.5">
              <span className="text-[12px] font-semibold tracking-[0.1em] text-white/40 uppercase">{verb}</span>
              <span className={`text-[30px] leading-none font-bold tabular-nums ${timeColor}`}>{t(time)}</span>
              {countdown
                ? <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-0.5 text-[14px] font-semibold text-gold ring-1 ring-gold/40"><Clock size={13} aria-hidden="true" /> {countdown}</span>
                : <span className={`ml-auto text-right text-[16px] ${late ? 'font-semibold text-red-300' : 'text-white/55'}`}>{sub}</span>}
            </div>
          </div>
        )}
      </div>

      {progress != null && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-white/5" aria-hidden="true">
          <span className={`block h-full ${dot}`} style={{ width: `${progress * 100}%` }} />
        </span>
      )}
    </article>
  )
}

/** Completed-today trips: a compact, subordinate strip under the active cards. Plate · destination · return time. */
function CompletedToday({ trips, now }) {
  return (
    <section className="mt-6" aria-labelledby="done-title">
      <div className="mb-3 flex items-center gap-3">
        <CircleCheck size={22} className="text-emerald-400" aria-hidden="true" />
        <h2 id="done-title" className="text-[20px] font-bold tracking-tight text-white/80">Completed Today</h2>
        <span className="rounded-full bg-white/10 px-2.5 text-[16px] font-semibold text-white/60 tabular-nums">{trips.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {trips.slice(0, COMPLETED_SHOWN).map((r) => (
          <div key={r.ticket_number} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-2.5 ring-1 ring-white/10">
            <Plate>{r.plate_number}</Plate>
            <span className="min-w-0 flex-1 truncate text-[18px] text-white/65" title={r.destination}>{r.destination}</span>
            <span className="shrink-0 text-[17px] font-semibold text-emerald-300/90 tabular-nums">Back {when(r.returned_at, now)}</span>
          </div>
        ))}
        {trips.length > COMPLETED_SHOWN && (
          <div className="flex items-center px-4 py-2.5 text-[17px] font-medium text-white/45">+{trips.length - COMPLETED_SHOWN} more returned today</div>
        )}
      </div>
    </section>
  )
}

/** Whole vehicle photo, fitted (not cropped) on a light tile; multiply blends the photo's white background in. */
function VehicleImage({ r, className }) {
  return (
    <div className={`shrink-0 self-stretch overflow-hidden rounded-[20px] bg-gradient-to-b from-white to-slate-200 ${className}`}>
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

function Avatar({ name, src, size }) {
  const style = { width: size, height: size }
  return src
    ? <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover ring-2 ring-white/20" />
    : <span style={{ ...style, fontSize: size * 0.36 }} className="flex shrink-0 items-center justify-center rounded-full bg-white/10 font-bold text-white ring-1 ring-white/15" aria-hidden="true">{initials(name)}</span>
}

/** Plate tag: white plate, navy letters, spaced like a real plate. */
function Plate({ children, big }) {
  return (
    <span className={`inline-block shrink-0 rounded-lg bg-white font-extrabold tracking-[0.1em] whitespace-nowrap shadow-[inset_0_-2px_0_rgb(0_0_0/.12)] ${big ? 'px-4 py-1 text-[44px] leading-tight' : 'px-1.5 text-[15px] leading-6'}`} style={{ color: NAVY }}>
      {children}
    </span>
  )
}

function Stat({ icon: Icon, label, value, tone, alert }) {
  return (
    <div className={`flex flex-col rounded-[24px] p-5 ${glass} ${alert ? 'ring-red-400/50' : ''}`}>
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}><Icon size={22} aria-hidden="true" /></span>
      {/* dt before dd for screen readers; the number is shown first. */}
      <dt className="order-last mt-2 text-[18px] font-medium text-white/55">{label}</dt>
      <dd className={`mt-4 text-[56px] leading-none font-bold tracking-tight tabular-nums ${alert ? 'text-red-300' : 'text-white'}`}>{value}</dd>
    </div>
  )
}

/** A day's worth of upcoming trips: a slim day header (date shown once), then its trip rows. */
function AgendaDay({ g, now }) {
  const tomorrow = sameDay(g.date, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  return (
    <div className="pt-2 first:pt-0">
      <div className="flex items-center gap-2.5 px-2 pb-1.5">
        <span className={`h-4 w-1.5 rounded-full ${tomorrow ? 'bg-gold' : 'bg-white/25'}`} aria-hidden="true" />
        <span className={`text-[15px] font-bold tracking-wide uppercase ${tomorrow ? 'text-gold' : 'text-white/75'}`}>{tomorrow ? 'Tomorrow' : wk.format(g.date)}</span>
        <span className="text-[15px] font-medium text-white/40">{shortDay.format(g.date)}</span>
        {g.trips.length > 1 && <span className="ml-auto text-[14px] font-medium text-white/40 tabular-nums">{g.trips.length} trips</span>}
      </div>
      <ul className="space-y-1">
        {g.trips.map((r) => (
          <li key={r.ticket_number} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-2 py-1.5">
            <div className="aspect-[4/3] w-[70px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-white to-slate-200">
              {r.vehicle_photo_url
                ? <img src={r.vehicle_photo_url} alt="" className="h-full w-full object-contain p-1 mix-blend-multiply" />
                : <div className="flex h-full items-center justify-center text-slate-400"><Car size={24} strokeWidth={1.5} aria-hidden="true" /></div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <span className="text-[18px] font-bold text-white tabular-nums">{t(r.scheduled_departure)}</span>
                <Plate>{r.plate_number}</Plate>
              </div>
              <div className="mt-0.5 truncate text-[16px] font-semibold text-white/80" title={r.destination}>{r.destination}</div>
              {r.purpose && (
                <div className="mt-0.5 flex items-center gap-1 text-[14px] text-white/45">
                  <ClipboardList size={13} className="shrink-0" aria-hidden="true" />
                  <span className="truncate" title={r.purpose}>{r.purpose}</span>
                </div>
              )}
            </div>
            <Avatar name={r.driver_name} src={r.driver_photo_url} size={34} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Empty({ next, now }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-[28px] py-20 ${glass}`}>
      <span className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white/10 text-white/50"><Car size={48} strokeWidth={1.5} aria-hidden="true" /></span>
      <p className="mt-6 text-[36px] font-bold text-white">All vehicles are at the motor pool</p>
      <p className="mt-2 text-[22px] text-white/55">No trips on the road and no more departures today.</p>
      {next && (
        <div className="mt-10 flex items-center gap-5 rounded-2xl bg-white/[0.06] px-6 py-4 ring-1 ring-white/10">
          <span className="text-[15px] font-semibold tracking-[0.12em] text-white/45 uppercase">Next trip</span>
          <span className="text-[24px] font-bold text-white tabular-nums">{wk.format(new Date(next.scheduled_departure))} {when(next.scheduled_departure, now)}</span>
          <Plate>{next.plate_number}</Plate>
          <span className="max-w-[420px] truncate text-[20px] text-white/70">{next.destination}</span>
        </div>
      )}
    </div>
  )
}

/** Fixed 1920x1080 canvas scaled to the screen (letterboxed in navy if the TV isn't 16:9). */
function Stage({ children }) {
  const scale = useStageScale()
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: NAVY }}>
      <div className="absolute top-1/2 left-1/2 flex flex-col overflow-hidden font-['Inter',ui-sans-serif,system-ui,'Segoe_UI',sans-serif] antialiased"
        style={{ width: W, height: H, background: BACKDROP, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}
