import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CalendarDays, Car, CircleCheck, Clock, MonitorOff, Navigation, RefreshCw, TriangleAlert, UserRound, WifiOff } from 'lucide-react'
import { api } from '../../api'

/*
 * Lobby TV trip board: /display?token=<screen token>. No staff login; the token is created in Django admin
 * (Operations > Display screens) and revoked by unticking "is active".
 *
 * Drawn on a fixed 1920x1080 stage that is scaled to fit the screen, so Full HD, 4K and smaller TVs show the
 * exact same layout. Left (about 70%): today's trips, active ones first. Right: today's counts, next 7 days.
 */

const W = 1920
const H = 1080
const REFRESH_MS = 60_000
const PAGE_MS = 12_000
const ROWS = 6
const AGENDA_ROWS = 5
const FONT = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'

const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const shortDay = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
const wk = new Intl.DateTimeFormat('en-PH', { weekday: 'short' })
const t = (v) => (v ? timeFmt.format(new Date(v)) : '')
const sameDay = (a, b) => a.toDateString() === b.toDateString()

/** Time, with the date in front when it isn't today (overnight trips): "Oct 12, 5:49 PM". */
function when(v, now) {
  if (!v) return ''
  const d = new Date(v)
  return sameDay(d, now) ? timeFmt.format(d) : `${shortDay.format(d)}, ${timeFmt.format(d)}`
}

/** 135 -> "2h 15m", 50 -> "50 min", 1600 -> "1d 2h" */
function span(minutes) {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
}
const since = (v, now) => (now - new Date(v)) / 60_000

// Active trips first (on trip, then still to leave), then finished ones.
const ORDER = { DISPATCHED: 0, SCHEDULED: 1, COMPLETED: 2, CANCELLED: 3 }
const sortKey = (r) => new Date(r.status === 'COMPLETED' ? r.returned_at : r.departed_at ?? r.scheduled_departure).getTime()

/** label, badge classes, row accent. Overdue (late return) is red; a late departure is orange. */
function statusOf(r) {
  if (r.flag === 'OVERDUE') return ['Overdue', 'bg-red-50 text-red-700 ring-red-200', 'bg-red-600']
  if (r.flag === 'DELAYED') return ['Delayed', 'bg-orange-50 text-orange-700 ring-orange-200', 'bg-orange-500']
  return {
    DISPATCHED: ['On trip', 'bg-blue-50 text-brand ring-blue-200', 'bg-brand'],
    SCHEDULED: ['Scheduled', 'bg-amber-50 text-amber-800 ring-amber-200', 'bg-amber-400'],
    COMPLETED: ['Returned', 'bg-emerald-50 text-emerald-700 ring-emerald-200', 'bg-emerald-500'],
    CANCELLED: ['Cancelled', 'bg-slate-100 text-slate-500 ring-slate-200', 'bg-slate-300'],
  }[r.status]
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

/** Scale factor that fits the 1920x1080 stage into the window. */
function useStageScale() {
  const get = () => Math.min(window.innerWidth / W, window.innerHeight / H)
  const [scale, setScale] = useState(get)
  useEffect(() => {
    const onResize = () => setScale(get())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return scale
}

/** Inter for the TV only (falls back to the system font when offline). */
function useFont() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT}"]`)) return
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONT })
    document.head.appendChild(link)
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
    placeholderData: keepPreviousData, // keep showing the last board while refreshing: no flicker
    enabled: !!token,
  })

  const today = [...(q.data?.today ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || sortKey(a) - sortKey(b))
  const upcoming = q.data?.upcoming ?? []
  const count = (s) => today.filter((r) => r.status === s).length
  const late = today.filter((r) => r.flag).length
  const [page, pages] = usePager(today.length, ROWS)
  const rows = today.slice(page * ROWS, (page + 1) * ROWS)
  const offline = q.isError && !!q.data

  if (!token || q.error?.response?.status === 403) {
    return (
      <Stage>
        <div className="flex h-full items-center justify-center">
          <div className="w-[900px] rounded-2xl bg-white p-16 text-center ring-1 ring-slate-200">
            <MonitorOff size={64} strokeWidth={1.5} className="mx-auto text-slate-400" aria-hidden="true" />
            <p className="mt-8 text-[44px] font-bold text-[#0a1033]">Display not set up</p>
            <p className="mt-4 text-2xl leading-relaxed text-slate-500">This display link is missing, invalid or has been turned off.<br />Ask the System Administrator for a new link.</p>
          </div>
        </div>
      </Stage>
    )
  }

  return (
    <Stage>
      <style>{'@keyframes vrs-page { from { transform: scaleX(0) } to { transform: scaleX(1) } } @keyframes vrs-fade { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }'}</style>

      {/* Header */}
      <header className="relative flex h-[112px] items-center gap-6 bg-[#0a1033] px-12 text-white">
        <img src="/dole-emblem.png" alt="DOLE emblem" className="h-[72px] w-[72px] rounded-full bg-white p-1" />
        <div className="mr-auto">
          <div className="text-[15px] font-semibold tracking-[0.22em] text-gold uppercase">Department of Labor and Employment</div>
          <div className="mt-0.5 flex items-baseline gap-4">
            <h1 className="text-[40px] leading-none font-bold tracking-tight">Vehicle Trip Board</h1>
            <span className="text-[24px] font-medium text-white/60">{q.data?.office?.name ?? 'DOLE Region III'}</span>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <span className="flex items-center gap-2.5 text-[17px] font-medium text-white/70">
            <span className={`h-2.5 w-2.5 rounded-full ${offline ? 'bg-amber-400' : 'bg-emerald-400'}`} />
            {offline ? 'Reconnecting' : 'Live'}
          </span>
          <div className="h-14 w-px bg-white/15" aria-hidden="true" />
          <div className="text-right">
            <div className="text-[52px] leading-none font-bold tracking-tight tabular-nums">{timeFmt.format(now)}</div>
            <div className="mt-1.5 text-[18px] text-white/70">{dayFmt.format(now)}</div>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-gold" aria-hidden="true" />
      </header>

      {offline && (
        <div role="status" className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-12 py-2.5 text-[20px] font-medium text-amber-900">
          <WifiOff size={22} aria-hidden="true" /> Connection lost. Showing the board as of {t(q.data.generated_at)}; it updates again when the connection returns.
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_520px] gap-7 px-12 py-7">
        {/* Today's trips */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200" aria-labelledby="today-title">
          <div className="flex items-center gap-4 px-8 pt-6 pb-4">
            <h2 id="today-title" className="text-[30px] font-bold tracking-tight text-[#0a1033]">Today’s Trips</h2>
            <span className="rounded-full bg-slate-100 px-3 py-0.5 text-[18px] font-semibold text-slate-600 tabular-nums">{today.length}</span>
            {pages > 1 && <span className="ml-auto text-[18px] font-medium text-slate-500 tabular-nums">Page {page + 1} of {pages}</span>}
          </div>
          <div className="grid grid-cols-[180px_360px_1fr_190px] gap-6 border-y border-slate-100 bg-slate-50/80 px-8 py-2.5 text-[14px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            <span>Time</span><span>Vehicle · Driver</span><span>Destination</span><span className="text-right">Status</span>
          </div>

          {q.isLoading ? (
            <div className="divide-y divide-slate-100">
              {[...Array(ROWS)].map((_, i) => <div key={i} className="mx-8 my-6 h-[72px] rounded-lg bg-slate-100 motion-safe:animate-pulse" />)}
            </div>
          ) : today.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <span className="flex h-24 w-24 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Car size={48} strokeWidth={1.5} aria-hidden="true" /></span>
              <p className="mt-6 text-[34px] font-bold text-[#0a1033]">No trips today</p>
              <p className="mt-2 text-[22px] text-slate-500">
                {upcoming.length ? `Next departure: ${wk.format(new Date(upcoming[0].scheduled_departure))}, ${shortDay.format(new Date(upcoming[0].scheduled_departure))} at ${t(upcoming[0].scheduled_departure)}` : 'All vehicles are at the motor pool.'}
              </p>
            </div>
          ) : (
            <ol key={page} className="min-h-0 flex-1 divide-y divide-slate-100 motion-safe:animate-[vrs-fade_.6s_ease-out]">
              {rows.map((r) => <TripRow key={r.ticket_number} r={r} now={now} />)}
            </ol>
          )}

          {pages > 1 && (
            <div className="h-1 bg-slate-100" aria-hidden="true">
              <div key={page} className="h-full origin-left bg-brand/70" style={{ animation: `vrs-page ${PAGE_MS}ms linear` }} />
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-7">
          {/* Today at a glance */}
          <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200" aria-labelledby="glance-title">
            <h2 id="glance-title" className="mb-4 text-[22px] font-bold tracking-tight text-[#0a1033]">Today at a Glance</h2>
            <div className="grid grid-cols-2 gap-3">
              <Kpi icon={Navigation} value={count('DISPATCHED')} label="On trip" accent="text-brand bg-blue-50" />
              <Kpi icon={Clock} value={count('SCHEDULED')} label="Still to leave" accent="text-amber-700 bg-amber-50" />
              <Kpi icon={CircleCheck} value={count('COMPLETED')} label="Returned" accent="text-emerald-700 bg-emerald-50" />
              <Kpi icon={TriangleAlert} value={late} label="Running late" accent={late ? 'text-red-700 bg-red-50' : 'text-slate-400 bg-slate-100'} warn={late > 0} />
            </div>
          </section>

          {/* Next 7 days */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200" aria-labelledby="next-title">
            <div className="flex items-center gap-3 px-6 pt-6 pb-4">
              <CalendarDays size={24} className="text-brand" aria-hidden="true" />
              <h2 id="next-title" className="text-[22px] font-bold tracking-tight text-[#0a1033]">Next 7 Days</h2>
              <span className="ml-auto text-[17px] font-medium text-slate-500 tabular-nums">{upcoming.length} booked</span>
            </div>
            {upcoming.length === 0 ? (
              <div className="mx-6 mb-6 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 text-center">
                <CalendarDays size={40} strokeWidth={1.5} className="text-slate-300" aria-hidden="true" />
                <p className="mt-3 text-[22px] font-semibold text-slate-600">No upcoming bookings</p>
                <p className="mt-1 text-[17px] text-slate-400">New schedules appear here automatically.</p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-hidden border-t border-slate-100">
                {upcoming.slice(0, AGENDA_ROWS).map((r, i) => (
                  <AgendaRow key={r.ticket_number} r={r} now={now} first={i === 0 || !sameDay(new Date(upcoming[i - 1].scheduled_departure), new Date(r.scheduled_departure))} />
                ))}
                {upcoming.length > AGENDA_ROWS && (
                  <li className="px-6 py-3 text-[17px] font-medium text-slate-500">+{upcoming.length - AGENDA_ROWS} more this week</li>
                )}
              </ul>
            )}
          </section>
        </aside>
      </main>

      {/* Footer */}
      <footer className="flex h-11 items-center gap-6 border-t border-slate-200 bg-white px-12 text-[16px] text-slate-500">
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

function TripRow({ r, now }) {
  const [label, badge, accent] = statusOf(r)
  const done = r.status === 'COMPLETED' || r.status === 'CANCELLED'
  const cancelled = r.status === 'CANCELLED'
  const long = r.destination.length > 55
  const [verb, time] = r.status === 'DISPATCHED' ? ['Departed', r.departed_at]
    : r.status === 'COMPLETED' ? ['Returned', r.returned_at]
      : [cancelled ? 'Was set for' : 'Departs', r.scheduled_departure]

  let detail = null
  if (r.status === 'DISPATCHED') {
    detail = r.flag === 'OVERDUE'
      ? <span className="font-semibold text-red-700">Expected back {when(r.scheduled_return, now)} · {span(since(r.scheduled_return, now))} overdue</span>
      : <>On the road {span(since(r.departed_at, now))}{r.scheduled_return && <> · expected back <span className="font-semibold text-slate-700">{when(r.scheduled_return, now)}</span></>}</>
  } else if (r.status === 'SCHEDULED') {
    detail = r.flag === 'DELAYED'
      ? <span className="font-semibold text-orange-700">Not yet departed · {span(since(r.scheduled_departure, now))} past schedule</span>
      : r.scheduled_return ? <>Expected back {when(r.scheduled_return, now)}</> : <>Reserved for the rest of the day</>
  } else if (r.status === 'COMPLETED' && r.departed_at) {
    detail = <>Departed {when(r.departed_at, now)} · {span((new Date(r.returned_at) - new Date(r.departed_at)) / 60_000)} trip</>
  }

  return (
    <li className={`relative grid h-[124px] grid-cols-[180px_360px_1fr_190px] items-center gap-6 px-8 ${done ? 'bg-slate-50/60' : ''}`}>
      <span className={`absolute inset-y-4 left-0 w-1.5 rounded-r-full ${accent} ${done ? 'opacity-50' : ''}`} aria-hidden="true" />

      <div>
        {/* overnight trips: the date goes in the label so the time stays on one line */}
        <div className="text-[14px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
          {verb}{time && !sameDay(new Date(time), now) && <span className="text-slate-600"> · {shortDay.format(new Date(time))}</span>}
        </div>
        <div className={`mt-0.5 leading-none font-bold tracking-tight whitespace-nowrap tabular-nums ${done ? 'text-[30px] text-slate-400' : r.flag ? 'text-[38px] text-red-700' : 'text-[38px] text-[#0a1033]'}`}>
          {t(time)}
        </div>
      </div>

      <div className={`flex min-w-0 items-center gap-4 ${done ? 'opacity-60' : ''}`}>
        <div className="relative h-[80px] w-[120px] shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
          {r.vehicle_photo_url
            ? <img src={r.vehicle_photo_url} alt="" className="h-full w-full object-cover" />
            : <Car size={38} strokeWidth={1.5} className="absolute inset-0 m-auto text-slate-300" aria-hidden="true" />}
        </div>
        <div className="min-w-0">
          <Plate>{r.plate_number}</Plate>
          <div className="mt-2 flex items-center gap-1.5 text-[18px] text-slate-600">
            <UserRound size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate">{r.driver_name}</span>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        {/* long destinations get a smaller size and a third line instead of being cut off */}
        <div className={`leading-[1.15] font-bold tracking-tight ${long ? 'line-clamp-3' : 'line-clamp-2'} ${done ? (long ? 'text-[21px]' : 'text-[24px]') + ' text-slate-500' : (long ? 'text-[23px]' : 'text-[28px]') + ' text-[#0a1033]'} ${cancelled ? 'line-through decoration-slate-400' : ''}`} title={r.destination}>
          {r.destination}
        </div>
        {detail && <div className="mt-1.5 truncate text-[18px] text-slate-500">{detail}</div>}
      </div>

      <div className="flex justify-end">
        <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[18px] font-semibold ring-1 ${badge}`}>
          <span className={`h-2 w-2 rounded-full ${accent}`} aria-hidden="true" />
          {label}
        </span>
      </div>
    </li>
  )
}

function AgendaRow({ r, now, first }) {
  const d = new Date(r.scheduled_departure)
  const tomorrow = sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  return (
    <li className={`flex h-[66px] items-center gap-4 px-6 ${first ? 'border-t border-slate-100 first:border-t-0' : ''}`}>
      <span className="w-[100px] shrink-0">
        {first && (
          <span className={`flex flex-col items-center rounded-lg py-1 leading-none ${tomorrow ? 'bg-brand text-white' : 'bg-slate-100 text-slate-700'}`}>
            <span className={`text-[12px] font-bold tracking-[0.06em] uppercase ${tomorrow ? 'text-gold' : 'text-slate-500'}`}>{tomorrow ? 'Tomorrow' : wk.format(d)}</span>
            <span className="mt-1 text-[18px] font-bold">{shortDay.format(d)}</span>
          </span>
        )}
      </span>
      <span className="w-[100px] shrink-0 text-[20px] font-bold text-[#0a1033] tabular-nums">{t(r.scheduled_departure)}</span>
      <span className="min-w-0 flex-1">
        <Plate small>{r.plate_number}</Plate>
        <span className="mt-0.5 block truncate text-[17px] text-slate-500" title={r.destination}>{r.destination}</span>
      </span>
    </li>
  )
}

/** Plate tag: white plate, thin dark border, spaced letters (distinct from the surrounding text). */
function Plate({ children, small }) {
  return (
    <span className={`inline-block rounded-md border-[1.5px] border-slate-700 bg-white font-semibold tracking-[0.14em] text-slate-800 tabular-nums ${small ? 'px-1.5 text-[15px] leading-6' : 'px-2.5 py-0.5 text-[22px]'}`}>
      {children}
    </span>
  )
}

function Kpi({ icon: Icon, value, label, accent, warn }) {
  return (
    <div className={`rounded-xl p-4 ring-1 ${warn ? 'bg-red-50/60 ring-red-200' : 'bg-slate-50 ring-slate-100'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[17px] font-medium text-slate-500">{label}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}><Icon size={20} aria-hidden="true" /></span>
      </div>
      <div className={`mt-1 text-[52px] leading-none font-bold tracking-tight tabular-nums ${warn ? 'text-red-700' : 'text-[#0a1033]'}`}>{value}</div>
    </div>
  )
}

/** Fixed 1920x1080 canvas scaled to the screen (letterboxed in navy if the TV isn't 16:9). */
function Stage({ children }) {
  const scale = useStageScale()
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0a1033]">
      <div className="absolute top-1/2 left-1/2 flex flex-col overflow-hidden bg-[#eef1f6] font-['Inter',ui-sans-serif,system-ui,'Segoe_UI',sans-serif] antialiased"
        style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}
