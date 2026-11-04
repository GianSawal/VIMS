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
 * 4K and smaller TVs all show the same layout. Dark, flat theme: less glare in a lit lobby and readable from afar.
 */

const W = 1920
const H = 1080
const REFRESH_MS = 60_000
const PAGE_MS = 12_000
const COMPLETED_SHOWN = 4
const FONT = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
const NAVY = '#060a1c'
const BACKDROP = `linear-gradient(180deg, #0c1436 0%, #080d26 45%, ${NAVY} 100%)`
const panel = 'bg-white/[0.04] ring-1 ring-white/[0.08]'

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
          <div className={`w-[900px] rounded-2xl p-16 text-center ${panel}`}>
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

      {/* Header: identity on the left, clock on the right */}
      <header className="flex h-[128px] shrink-0 items-center gap-6 px-14">
        <img src="/dole-emblem.png" alt="DOLE emblem" className="h-[72px] w-[72px] rounded-full bg-white p-1" />
        <div className="mr-auto min-w-0">
          <div className="text-[14px] font-semibold tracking-[0.24em] text-gold uppercase">Department of Labor and Employment</div>
          <div className="mt-2 flex items-baseline gap-5">
            <h1 className="text-[42px] leading-none font-extrabold tracking-tight text-white">Vehicle Trip Board</h1>
            <span className="h-8 w-px self-center bg-white/20" aria-hidden="true" />
            <span className="truncate text-[24px] font-medium text-white/65">{q.data?.office?.name ?? 'DOLE Region III'}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[60px] leading-none font-bold tracking-tight text-white tabular-nums">{timeFmt.format(now)}</div>
          <div className="mt-2 text-[18px] font-medium text-white/55">{dayFmt.format(now)}</div>
        </div>
      </header>
      <div className="mx-14 h-px shrink-0 bg-white/10" aria-hidden="true" />

      {offline && (
        <div role="status" className="mx-14 mt-4 flex shrink-0 items-center gap-3 rounded-xl bg-amber-400/10 px-6 py-3 text-[20px] font-medium text-amber-200 ring-1 ring-amber-400/30">
          <WifiOff size={22} aria-hidden="true" /> Connection lost. Showing the board as of {t(q.data.generated_at)}; it updates again when the connection returns.
        </div>
      )}

      {/* Today at a glance: one bar, four figures */}
      <dl className={`mx-14 mt-6 grid shrink-0 grid-cols-4 divide-x divide-white/[0.08] overflow-hidden rounded-2xl ${panel}`} aria-label="Today">
        <Stat icon={Navigation} label="On the road" value={onRoad} color="text-sky-300" />
        <Stat icon={Clock} label="Leaving later today" value={active.length - onRoad} color="text-gold" />
        <Stat icon={CircleCheck} label="Returned today" value={completed.length} color="text-emerald-300" />
        <Stat icon={TriangleAlert} label="Running late" value={late} color={late ? 'text-red-300' : 'text-white/35'} alert={late > 0} />
      </dl>

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_520px] gap-8 px-14 py-6">
        {/* Active trips */}
        <section className="flex min-h-0 flex-col" aria-labelledby="active-title">
          <div className="mb-4 flex items-center gap-4">
            <h2 id="active-title" className="text-[26px] font-bold tracking-tight text-white">Active Trips</h2>
            <span className="rounded-md bg-white/10 px-2.5 py-0.5 text-[17px] font-bold text-white tabular-nums">{active.length}</span>
            <span className="text-[18px] text-white/45">On the road and leaving today</span>
            {pages > 1 && (
              <span className="ml-auto flex items-center gap-2" aria-label={`Page ${page + 1} of ${pages}`}>
                {Array.from({ length: pages }, (_, i) => <span key={i} className={`h-2 rounded-full transition-all duration-300 ${i === page ? 'w-8 bg-gold' : 'w-2 bg-white/25'}`} />)}
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
                {shown.map((r) => <TripCard key={r.ticket_number} r={r} now={now} featured={featured} wide={cols === 1} />)}
              </motion.div>
            </AnimatePresence>
          )}

          {pages > 1 && (
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <div key={page} className="h-full origin-left bg-gold/70" style={{ animation: `vrs-page ${PAGE_MS}ms linear` }} />
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-6">
          <section className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl ${panel}`} aria-labelledby="next-title">
            <PanelHead id="next-title" icon={CalendarDays} iconColor="text-gold" title="Next 7 Days" count={`${upcoming.length} booked`} />
            {upcoming.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <p className="text-[21px] font-semibold text-white/75">No upcoming bookings</p>
                <p className="mt-1 text-[16px] text-white/45">New schedules appear here automatically.</p>
              </div>
            ) : (
              <div className="min-h-0 overflow-hidden pb-2">
                {agenda.map((g) => <AgendaDay key={g.key} g={g} now={now} />)}
                {upcoming.length > agendaCount && <div className="border-t border-white/[0.06] px-6 pt-3 text-[16px] font-medium text-white/50">+{upcoming.length - agendaCount} more this week</div>}
              </div>
            )}
          </section>

          {completed.length > 0 && <CompletedToday trips={completed} now={now} />}
        </aside>
      </main>

      <footer className="mx-14 flex h-[52px] shrink-0 items-center gap-6 border-t border-white/10 text-[16px] text-white/45">
        <span className="font-semibold text-white/70">{q.data?.screen ?? 'Lobby TV'}</span>
        <span className="h-4 w-px bg-white/15" aria-hidden="true" />
        <span className="mr-auto">For trip changes, please coordinate with the Fleet Administrator.</span>
        <span className="flex items-center gap-2.5 tabular-nums">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            {!offline && q.data && <span className="absolute inset-0 rounded-full bg-emerald-400 motion-safe:animate-ping" />}
            <span className={`relative h-2.5 w-2.5 rounded-full ${offline || !q.data ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          </span>
          {offline ? 'Reconnecting…' : q.data ? `Live · updated ${t(q.data.generated_at)}` : 'Connecting…'}
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
    <article className={`relative flex min-w-0 gap-5 overflow-hidden rounded-2xl p-3 pl-4 ${late ? 'bg-red-500/[0.06] ring-1 ring-red-400/45' : panel}`}>
      <span className={`absolute inset-y-0 left-0 w-1.5 ${dot}`} aria-hidden="true" />
      <VehicleImage r={r} className={featured ? 'w-[380px]' : 'w-[230px]'} />

      <div className={`flex min-w-0 flex-1 flex-col ${featured ? 'gap-4 py-4 pr-5' : 'gap-2.5 py-2 pr-3'}`}>
        {/* Plate + model, status */}
        <div className="flex items-start gap-4">
          <div className="min-w-0">
            <Plate size={featured ? 'lg' : 'sm'}>{r.plate_number}</Plate>
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
                <div className={`font-semibold text-white/90 ${featured ? 'text-[24px]' : 'text-[20px]'}`}>{r.driver_name ?? 'Driver TBA'}</div>
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
              <span className="min-w-0 flex-1 truncate text-[19px] font-semibold text-white/90" title={r.driver_name ?? 'Driver TBA'}>{r.driver_name ?? 'Driver TBA'}</span>
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

/** Panel title row with an icon, title and a count on the right. */
function PanelHead({ id, icon: Icon, iconColor, title, count }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] px-6 py-4">
      <Icon size={22} className={iconColor} aria-hidden="true" />
      <h2 id={id} className="text-[21px] font-bold tracking-tight text-white">{title}</h2>
      <span className="ml-auto text-[16px] font-medium text-white/50 tabular-nums">{count}</span>
    </div>
  )
}

/** Trips completed today: a compact list in the side column. Plate · destination · return time. */
function CompletedToday({ trips, now }) {
  return (
    <section className={`shrink-0 overflow-hidden rounded-2xl ${panel}`} aria-labelledby="done-title">
      <PanelHead id="done-title" icon={CircleCheck} iconColor="text-emerald-400" title="Returned Today" count={trips.length} />
      <ul>
        {trips.slice(0, COMPLETED_SHOWN).map((r) => (
          <li key={r.ticket_number} className="flex items-center gap-4 border-t border-white/[0.06] px-6 py-3 first:border-t-0">
            <Plate>{r.plate_number}</Plate>
            <span className="min-w-0 flex-1 truncate text-[17px] text-white/70" title={r.destination}>{r.destination}</span>
            <span className="shrink-0 text-[17px] font-semibold text-emerald-300 tabular-nums">{when(r.returned_at, now)}</span>
          </li>
        ))}
      </ul>
      {trips.length > COMPLETED_SHOWN && (
        <div className="border-t border-white/[0.06] px-6 py-2.5 text-[16px] font-medium text-white/45">+{trips.length - COMPLETED_SHOWN} more returned today</div>
      )}
    </section>
  )
}

/** Whole vehicle photo, fitted (not cropped) on a light tile; multiply blends the photo's white background in. */
function VehicleImage({ r, className }) {
  return (
    <div className={`shrink-0 self-stretch overflow-hidden rounded-xl bg-gradient-to-b from-white to-slate-200 ${className}`}>
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
  if (src) return <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover ring-2 ring-white/20" />
  return (
    <span style={{ ...style, fontSize: size * 0.36 }} className="flex shrink-0 items-center justify-center rounded-full bg-white/10 font-bold text-white/85 ring-1 ring-white/15" aria-hidden="true">
      {name ? initials(name) : <UserRound size={size * 0.5} className="text-white/45" />}
    </span>
  )
}

/** Plate tag: white plate, navy letters, spaced like a real plate. */
const PLATE_SIZES = { sm: 'rounded-md px-2 text-[15px] leading-7', md: 'rounded-lg px-3 py-0.5 text-[24px] leading-tight', lg: 'rounded-lg px-4 py-1 text-[44px] leading-tight' }
function Plate({ children, size = 'sm' }) {
  return (
    <span className={`inline-block shrink-0 bg-white font-extrabold tracking-[0.1em] whitespace-nowrap ${PLATE_SIZES[size]}`} style={{ color: NAVY }}>
      {children}
    </span>
  )
}

function Stat({ icon: Icon, label, value, color, alert }) {
  return (
    <div className={`flex items-center gap-5 px-8 py-5 ${alert ? 'bg-red-500/10' : ''}`}>
      {/* dt before dd for screen readers; the number is shown first. */}
      <dt className="order-last flex items-center gap-2.5 text-[19px] font-medium text-white/60">
        <Icon size={22} className={color} aria-hidden="true" />{label}
      </dt>
      <dd className={`text-[52px] leading-none font-bold tracking-tight tabular-nums ${alert ? 'text-red-300' : 'text-white'}`}>{value}</dd>
    </div>
  )
}

/** A day's worth of upcoming trips: a slim day header (date shown once), then rows of time · plate · destination. */
function AgendaDay({ g, now }) {
  const tomorrow = sameDay(g.date, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  return (
    <div>
      <div className="flex items-center gap-2.5 bg-white/[0.03] px-6 py-2">
        <span className={`text-[14px] font-bold tracking-[0.12em] uppercase ${tomorrow ? 'text-gold' : 'text-white/75'}`}>{tomorrow ? 'Tomorrow' : wk.format(g.date)}</span>
        <span className="text-[14px] font-medium text-white/45">{shortDay.format(g.date)}</span>
        {g.trips.length > 1 && <span className="ml-auto text-[14px] font-medium text-white/40 tabular-nums">{g.trips.length} trips</span>}
      </div>
      <ul>
        {g.trips.map((r) => (
          <li key={r.ticket_number} className="flex items-start gap-4 border-t border-white/[0.06] px-6 py-3 first:border-t-0">
            <span className="w-[96px] shrink-0 pt-0.5 text-[19px] font-bold text-white tabular-nums">{t(r.scheduled_departure)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <Plate>{r.plate_number}</Plate>
                <span className="min-w-0 truncate text-[18px] font-semibold text-white/90" title={r.destination}>{r.destination}</span>
              </div>
              <div className="mt-1 truncate text-[15px] text-white/50" title={r.purpose}>
                {[r.purpose, r.driver_name].filter(Boolean).join(' · ') || 'Driver to be assigned'}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Empty({ next, now }) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center rounded-2xl px-12 text-center ${panel}`}>
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25">
        <CircleCheck size={40} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="mt-7 text-[38px] font-bold tracking-tight text-white">All vehicles are at the motor pool</p>
      <p className="mt-3 text-[22px] text-white/55">No trips on the road and no more departures today.</p>
      {next && (
        <div className="mt-12 w-full max-w-[880px] border-t border-white/10 pt-8">
          <div className="text-[14px] font-semibold tracking-[0.18em] text-white/45 uppercase">Next scheduled trip</div>
          <div className="mt-4 flex items-center justify-center gap-5">
            <span className="text-[28px] font-bold text-white tabular-nums">{wk.format(new Date(next.scheduled_departure))}, {when(next.scheduled_departure, now)}</span>
            <span className="h-7 w-px bg-white/15" aria-hidden="true" />
            <Plate size="md">{next.plate_number}</Plate>
            <span className="max-w-[380px] truncate text-[24px] font-medium text-white/75">{next.destination}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Fixed 1920x1080 canvas scaled to the screen (letterboxed in navy if the TV isn't 16:9). A thin DOLE tricolor tops it. */
function Stage({ children }) {
  const scale = useStageScale()
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: NAVY }}>
      <div className="absolute top-1/2 left-1/2 flex flex-col overflow-hidden font-['Inter',ui-sans-serif,system-ui,'Segoe_UI',sans-serif] antialiased"
        style={{ width: W, height: H, background: BACKDROP, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div className="flex h-1 shrink-0" aria-hidden="true">
          <span className="flex-1 bg-brand" /><span className="flex-1 bg-accent" /><span className="flex-1 bg-gold" />
        </div>
        {children}
      </div>
    </div>
  )
}
