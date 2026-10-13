import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CalendarDays, Car, Clock, MapPin, MonitorOff, Navigation, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react'
import { api } from '../../api'
import { initials } from '../../components/filters'

/*
 * Lobby TV trip board: /display?token=<screen token>. No staff login; the token is created in Django admin
 * (Operations > Display screens) and revoked by unticking "is active".
 *
 * Shows only what is still active: vehicles on a trip now and today's bookings that haven't left (the API
 * leaves out returned and cancelled trips). Drawn on a fixed 1920x1080 stage scaled to the screen, so Full HD,
 * 4K and smaller TVs all show the same layout.
 */

const W = 1920
const H = 1080
const REFRESH_MS = 60_000
const PAGE_MS = 12_000
const CARDS = 4 // 2 x 2; with 1-2 trips the cards grow to fill the board
const AGENDA_ROWS = 5
const FONT = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
const NAVY = '#0a1033'

const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const shortDay = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
const wk = new Intl.DateTimeFormat('en-PH', { weekday: 'short' })
const t = (v) => (v ? timeFmt.format(new Date(v)) : '')
const sameDay = (a, b) => a.toDateString() === b.toDateString()
/** Time, with the date in front when it isn't today (overnight trips). */
const when = (v, now) => (!v ? '' : sameDay(new Date(v), now) ? t(v) : `${shortDay.format(new Date(v))}, ${t(v)}`)

/** 135 -> "2h 15m", 50 -> "50 min", 1600 -> "1d 2h" */
function span(minutes) {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
}
const minutes = (from, to) => (new Date(to) - new Date(from)) / 60_000

/** Status: label, pill classes, accent color class. Late return = red, late departure = orange. */
function statusOf(r) {
  if (r.flag === 'OVERDUE') return ['Overdue', 'bg-red-50 text-red-700 ring-red-200', 'bg-red-600']
  if (r.flag === 'DELAYED') return ['Delayed', 'bg-orange-50 text-orange-700 ring-orange-200', 'bg-orange-500']
  if (r.status === 'DISPATCHED') return ['On the road', 'bg-blue-50 text-brand ring-blue-200', 'bg-brand']
  return ['Scheduled', 'bg-amber-50 text-amber-800 ring-amber-200', 'bg-amber-400']
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

  // On the road first (longest out first), then today's departures by time. Finished trips are never sent.
  const active = (q.data?.today ?? []).filter((r) => r.status === 'DISPATCHED' || r.status === 'SCHEDULED')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'DISPATCHED' ? -1 : 1)
      || new Date(a.departed_at ?? a.scheduled_departure) - new Date(b.departed_at ?? b.scheduled_departure))
  const upcoming = q.data?.upcoming ?? []
  const onRoad = active.filter((r) => r.status === 'DISPATCHED').length
  const late = active.filter((r) => r.flag).length
  const [page, pages] = usePager(active.length, CARDS)
  const cards = active.slice(page * CARDS, (page + 1) * CARDS)
  const big = active.length <= 2
  const offline = q.isError && !!q.data

  if (!token || q.error?.response?.status === 403) {
    return (
      <Stage>
        <div className="flex h-full items-center justify-center">
          <div className="w-[900px] rounded-3xl bg-white p-16 text-center ring-1 ring-slate-200">
            <MonitorOff size={64} strokeWidth={1.5} className="mx-auto text-slate-400" aria-hidden="true" />
            <p className="mt-8 text-[44px] font-bold" style={{ color: NAVY }}>Display not set up</p>
            <p className="mt-4 text-2xl leading-relaxed text-slate-500">This display link is missing, invalid or has been turned off.<br />Ask the System Administrator for a new link.</p>
          </div>
        </div>
      </Stage>
    )
  }

  return (
    <Stage>
      <style>{'@keyframes vrs-page { from { transform: scaleX(0) } to { transform: scaleX(1) } } @keyframes vrs-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }'}</style>

      <header className="relative flex h-[108px] shrink-0 items-center gap-6 px-12 text-white" style={{ background: `linear-gradient(90deg, ${NAVY} 0%, #121c55 100%)` }}>
        <img src="/dole-emblem.png" alt="DOLE emblem" className="h-[70px] w-[70px] rounded-full bg-white p-1" />
        <div className="mr-auto">
          <div className="text-[15px] font-semibold tracking-[0.22em] text-gold uppercase">Department of Labor and Employment</div>
          <div className="mt-1 flex items-baseline gap-4">
            <h1 className="text-[40px] leading-none font-bold tracking-tight">Vehicle Trip Board</h1>
            <span className="text-[24px] font-medium text-white/60">{q.data?.office?.name ?? 'DOLE Region III'}</span>
          </div>
        </div>
        <span className="flex items-center gap-2.5 text-[17px] font-medium text-white/70">
          <span className={`h-2.5 w-2.5 rounded-full ${offline ? 'bg-amber-400' : 'bg-emerald-400'}`} aria-hidden="true" />
          {offline ? 'Reconnecting' : 'Live'}
        </span>
        <div className="h-14 w-px bg-white/15" aria-hidden="true" />
        <div className="text-right">
          <div className="text-[52px] leading-none font-bold tracking-tight tabular-nums">{timeFmt.format(now)}</div>
          <div className="mt-1.5 text-[18px] text-white/70">{dayFmt.format(now)}</div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-gold" aria-hidden="true" />
      </header>

      {offline && (
        <div role="status" className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-12 py-2.5 text-[20px] font-medium text-amber-900">
          <WifiOff size={22} aria-hidden="true" /> Connection lost. Showing the board as of {t(q.data.generated_at)}; it updates again when the connection returns.
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_500px] gap-7 px-12 py-7">
        {/* Active trips */}
        <section className="flex min-h-0 flex-col" aria-labelledby="active-title">
          <div className="mb-4 flex items-center gap-4">
            <h2 id="active-title" className="text-[30px] font-bold tracking-tight" style={{ color: NAVY }}>Active Trips</h2>
            <span className="text-[20px] font-medium text-slate-500">On the road and leaving today</span>
            {pages > 1 && (
              <span className="ml-auto flex items-center gap-2" aria-label={`Page ${page + 1} of ${pages}`}>
                {Array.from({ length: pages }, (_, i) => <span key={i} className={`h-2 rounded-full transition-all duration-300 ${i === page ? 'w-8 bg-brand' : 'w-2 bg-slate-300'}`} />)}
              </span>
            )}
          </div>

          {q.isLoading ? (
            <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-5">
              {[...Array(4)].map((_, i) => <div key={i} className="rounded-3xl bg-white/70 ring-1 ring-slate-200 motion-safe:animate-pulse" />)}
            </div>
          ) : active.length === 0 ? (
            <Empty next={upcoming[0]} now={now} />
          ) : (
            <div key={page} className={`grid min-h-0 flex-1 grid-cols-2 gap-5 motion-safe:animate-[vrs-in_.5s_ease-out] ${big ? 'grid-rows-1' : 'grid-rows-2'}`}>
              {cards.map((r) => <TripCard key={r.ticket_number} r={r} now={now} big={big} />)}
            </div>
          )}

          {pages > 1 && (
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
              <div key={page} className="h-full origin-left bg-brand/60" style={{ animation: `vrs-page ${PAGE_MS}ms linear` }} />
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-6">
          <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200" aria-labelledby="today-title">
            <h2 id="today-title" className="mb-2 text-[22px] font-bold tracking-tight" style={{ color: NAVY }}>Today</h2>
            <dl className="divide-y divide-slate-100">
              <Stat icon={Navigation} label="On the road" value={onRoad} tone="bg-blue-50 text-brand" />
              <Stat icon={Clock} label="Leaving later today" value={active.length - onRoad} tone="bg-amber-50 text-amber-700" />
              <Stat icon={TriangleAlert} label="Running late" value={late} tone={late ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-400'} alert={late > 0} />
            </dl>
          </section>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200" aria-labelledby="next-title">
            <div className="flex items-center gap-3 px-6 pt-6 pb-3">
              <CalendarDays size={24} className="text-brand" aria-hidden="true" />
              <h2 id="next-title" className="text-[22px] font-bold tracking-tight" style={{ color: NAVY }}>Next 7 Days</h2>
              <span className="ml-auto rounded-full bg-slate-100 px-3 py-0.5 text-[16px] font-semibold text-slate-600 tabular-nums">{upcoming.length} booked</span>
            </div>
            {upcoming.length === 0 ? (
              <div className="mx-6 mb-6 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 text-center">
                <CalendarDays size={40} strokeWidth={1.5} className="text-slate-300" aria-hidden="true" />
                <p className="mt-3 text-[22px] font-semibold text-slate-600">No upcoming bookings</p>
                <p className="mt-1 text-[17px] text-slate-400">New schedules appear here automatically.</p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
                {upcoming.slice(0, AGENDA_ROWS).map((r) => <AgendaRow key={r.ticket_number} r={r} now={now} />)}
                {upcoming.length > AGENDA_ROWS && <li className="px-3 pt-2 text-[17px] font-medium text-slate-500">+{upcoming.length - AGENDA_ROWS} more this week</li>}
              </ul>
            )}
          </section>
        </aside>
      </main>

      <footer className="flex h-11 shrink-0 items-center gap-6 border-t border-slate-200 bg-white px-12 text-[16px] text-slate-500">
        <span className="font-semibold text-slate-700">{q.data?.screen ?? 'Lobby TV'}</span>
        <span className="h-4 w-px bg-slate-200" aria-hidden="true" />
        <span className="mr-auto">For trip changes, please coordinate with the Fleet Administrator.</span>
        <span className="flex items-center gap-2 tabular-nums">
          <RefreshCw size={15} aria-hidden="true" />
          {q.data ? `Updated ${t(q.data.generated_at)} · refreshes every minute` : 'Connecting…'}
        </span>
      </footer>
    </Stage>
  )
}

/** One active trip: vehicle and driver (same look as the Trips list), status and time, destination. */
function TripCard({ r, now, big }) {
  const [label, pill, accent] = statusOf(r)
  const out = r.status === 'DISPATCHED'
  const late = !!r.flag
  const [verb, time] = out ? ['Departed', r.departed_at] : ['Departs', r.scheduled_departure]
  const sub = out
    ? (r.flag === 'OVERDUE' ? `${span(minutes(r.scheduled_return, now))} overdue` : `On the road ${span(minutes(r.departed_at, now))}`)
    : (r.flag === 'DELAYED' ? `${span(minutes(r.scheduled_departure, now))} past schedule` : `Leaves in ${span(minutes(now, r.scheduled_departure))}`)
  const back = r.scheduled_return && r.flag !== 'OVERDUE' ? `${out ? 'Expected back' : 'Back by'} ${when(r.scheduled_return, now)}` : null
  // Progress from departure to expected return (only when a return time was planned).
  const progress = out && r.scheduled_return
    ? Math.min(1, Math.max(0, minutes(r.departed_at, now) / Math.max(1, minutes(r.departed_at, r.scheduled_return)))) : null

  const status = (
    <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-[17px] font-semibold ring-1 ${pill}`}>
      <span className={`h-2 w-2 rounded-full ${accent}`} aria-hidden="true" /> {label}
    </span>
  )
  const clock = (
    <div>
      <div className="text-[14px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
        {verb}{!sameDay(new Date(time), now) && <span className="text-slate-600"> · {shortDay.format(new Date(time))}</span>}
      </div>
      <div className={`leading-none font-bold tracking-tight whitespace-nowrap tabular-nums ${big ? 'text-[48px]' : 'text-[40px]'} ${late ? 'text-red-700' : ''}`} style={late ? undefined : { color: NAVY }}>{t(time)}</div>
    </div>
  )
  const subLine = <div className={`text-[18px] whitespace-nowrap ${late ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{sub}</div>

  return (
    <article className={`relative flex min-h-0 flex-col overflow-hidden rounded-3xl bg-white ring-1 ${late ? 'ring-red-200' : 'ring-slate-200'}`}>
      <span className={`absolute inset-x-0 top-0 h-1.5 ${accent}`} aria-hidden="true" />

      {big ? (
        <div className="px-8 pt-8">
          <VehicleDriver r={r} big />
          <div className="mt-7 flex items-end gap-6 rounded-2xl bg-slate-50 px-6 py-4">
            <div className="mr-auto space-y-2">{status}{clock}</div>
            <div className="pb-1 text-right">{subLine}</div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-5 px-6 pt-6">
          <VehicleDriver r={r} />
          <div className="ml-auto flex shrink-0 flex-col items-end gap-2 text-right">{status}{clock}{subLine}</div>
        </div>
      )}

      {/* Destination */}
      <div className={`mt-5 flex min-h-0 flex-1 items-start gap-3 border-t border-slate-100 ${big ? 'px-8 pt-6' : 'px-6 pt-4'}`}>
        <MapPin size={big ? 30 : 26} className="mt-1 shrink-0 text-gold" aria-hidden="true" />
        <div className="min-w-0">
          <p className={`line-clamp-2 leading-[1.15] font-bold tracking-tight ${big ? 'text-[36px]' : r.destination.length > 50 ? 'text-[23px]' : 'text-[27px]'}`} style={{ color: NAVY }} title={r.destination}>
            {r.destination}
          </p>
          {back && <p className={`mt-1.5 text-slate-500 ${big ? 'text-[22px]' : 'text-[18px]'}`}>{back}</p>}
        </div>
      </div>

      {/* always reserve the bar's height so cards line up */}
      <div className={`h-1.5 ${progress != null ? 'bg-slate-100' : ''}`} aria-hidden="true">
        {progress != null && <div className={`h-full ${accent}`} style={{ width: `${progress * 100}%` }} />}
      </div>
    </article>
  )
}

/** Vehicle photo (whole, fitted on white), plate, model, and the driver with their photo, like the Trips list. */
function VehicleDriver({ r, big }) {
  return (
    <div className="flex min-w-0 items-center gap-5">
      <div className={`aspect-[4/3] shrink-0 overflow-hidden rounded-xl border border-slate-200 ${r.vehicle_photo_url ? 'bg-white' : 'bg-slate-100'} ${big ? 'w-[240px]' : 'w-[150px]'}`}>
        {r.vehicle_photo_url
          ? <img src={r.vehicle_photo_url} alt={`${r.vehicle_label} ${r.plate_number}`} className="h-full w-full object-contain" />
          : <div className="flex h-full items-center justify-center text-slate-400"><Car className="h-1/2 w-1/2" strokeWidth={1.25} aria-hidden="true" /></div>}
      </div>
      <div className="min-w-0">
        <div className={`leading-none font-bold tracking-wide whitespace-nowrap ${big ? 'text-[40px]' : 'text-[28px]'}`} style={{ color: NAVY }}>{r.plate_number}</div>
        <div className={`mt-1.5 truncate text-slate-500 ${big ? 'text-[22px]' : 'text-[17px]'}`}>{r.vehicle_label}</div>
        <div className="mt-3 flex min-w-0 items-center gap-2.5">
          <Avatar name={r.driver_name} src={r.driver_photo_url} size={big ? 44 : 32} />
          <span className={`truncate font-medium text-slate-700 ${big ? 'text-[22px]' : 'text-[17px]'}`}>{r.driver_name}</span>
        </div>
      </div>
    </div>
  )
}

function Avatar({ name, src, size }) {
  const style = { width: size, height: size }
  return src
    ? <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover ring-2 ring-white shadow-[0_0_0_1px_rgb(226_232_240)]" />
    : <span style={{ ...style, fontSize: size * 0.36 }} className="flex shrink-0 items-center justify-center rounded-full bg-brand-light font-bold text-brand" aria-hidden="true">{initials(name)}</span>
}

/** Plate tag: white plate, thin dark border, spaced letters. */
function Plate({ children, big, small }) {
  return (
    <span className={`inline-block rounded-md border-[1.5px] border-slate-700 bg-white font-semibold tracking-[0.14em] text-slate-800 ${small ? 'px-1.5 text-[15px] leading-6' : big ? 'px-3 py-0.5 text-[24px]' : 'px-2.5 py-0.5 text-[20px]'}`}>
      {children}
    </span>
  )
}

function Stat({ icon: Icon, label, value, tone, alert }) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon size={24} aria-hidden="true" /></span>
      <dt className="mr-auto text-[20px] font-medium text-slate-600">{label}</dt>
      <dd className={`text-[44px] leading-none font-bold tracking-tight tabular-nums ${alert ? 'text-red-700' : ''}`} style={alert ? undefined : { color: NAVY }}>{value}</dd>
    </div>
  )
}

function AgendaRow({ r, now }) {
  const d = new Date(r.scheduled_departure)
  const tomorrow = sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  return (
    <li className="flex items-center gap-4 rounded-2xl px-3 py-2.5 odd:bg-slate-50/80">
      <span className={`flex w-[92px] shrink-0 flex-col items-center rounded-xl py-1.5 leading-none ${tomorrow ? 'bg-brand text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>
        <span className={`text-[12px] font-bold tracking-[0.06em] uppercase ${tomorrow ? 'text-gold' : 'text-slate-500'}`}>{tomorrow ? 'Tomorrow' : wk.format(d)}</span>
        <span className="mt-1 text-[18px] font-bold">{shortDay.format(d)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-3">
          <span className="text-[20px] font-bold tabular-nums" style={{ color: NAVY }}>{t(r.scheduled_departure)}</span>
          <Plate small>{r.plate_number}</Plate>
        </span>
        <span className="mt-0.5 block truncate text-[17px] text-slate-500" title={r.destination}>{r.destination}</span>
      </span>
      <Avatar name={r.driver_name} src={r.driver_photo_url} size={40} />
    </li>
  )
}

function Empty({ next, now }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-3xl bg-white ring-1 ring-slate-200">
      <span className="flex h-24 w-24 items-center justify-center rounded-3xl bg-slate-100 text-slate-400"><Car size={48} strokeWidth={1.5} aria-hidden="true" /></span>
      <p className="mt-6 text-[36px] font-bold" style={{ color: NAVY }}>All vehicles are at the motor pool</p>
      <p className="mt-2 text-[22px] text-slate-500">No trips on the road and no more departures today.</p>
      {next && (
        <div className="mt-10 flex items-center gap-5 rounded-2xl bg-slate-50 px-6 py-4 ring-1 ring-slate-200">
          <span className="text-[15px] font-semibold tracking-[0.12em] text-slate-400 uppercase">Next trip</span>
          <span className="text-[24px] font-bold tabular-nums" style={{ color: NAVY }}>{wk.format(new Date(next.scheduled_departure))} {when(next.scheduled_departure, now)}</span>
          <Plate small>{next.plate_number}</Plate>
          <span className="max-w-[420px] truncate text-[20px] text-slate-600">{next.destination}</span>
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
      <div className="absolute top-1/2 left-1/2 flex flex-col overflow-hidden bg-[#eef1f6] font-['Inter',ui-sans-serif,system-ui,'Segoe_UI',sans-serif] antialiased"
        style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}
