import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { WifiOff } from 'lucide-react'
import { api } from '../../api'

/*
 * Wall TV board: /display?token=<screen token>. No staff login; the token is created in Django admin
 * (Operations > Display screens) and revoked by unticking "is active". Designed for 1920x1080 landscape.
 */

const REFRESH_MS = 60_000
const PAGE_MS = 12_000
const TODAY_ROWS = 8 // rows that fit at TV text size; longer lists page automatically

const STATUS = {
  SCHEDULED: ['Scheduled', 'bg-amber-400 text-slate-950'],
  DISPATCHED: ['On trip', 'bg-blue-500 text-white'],
  COMPLETED: ['Returned', 'bg-emerald-500 text-slate-950'],
  CANCELLED: ['Cancelled', 'bg-slate-500 text-white'],
}
const FLAG = { DELAYED: ['Delayed', 'bg-red-600 text-white'], OVERDUE: ['Overdue', 'bg-red-600 text-white'] }

const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const t = (v) => (v ? timeFmt.format(new Date(v)) : '')
const dayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const shortDay = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })

/** What the time column says for each state. */
function timeCell(r) {
  if (r.status === 'DISPATCHED') return [t(r.departed_at), 'Left']
  if (r.status === 'COMPLETED') return [t(r.returned_at), 'Back']
  return [t(r.scheduled_departure ?? r.departed_at), r.status === 'CANCELLED' ? 'Was' : 'Leaves']
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
  const current = page % pages // the list may shrink between refreshes
  return [current, pages]
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
  const [page, pages] = usePager(today.length, TODAY_ROWS)
  const rows = today.slice(page * TODAY_ROWS, (page + 1) * TODAY_ROWS)

  if (!token || q.error?.response?.status === 403) {
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center p-16 text-center">
          <div>
            <p className="text-5xl font-bold">Display not set up</p>
            <p className="mt-6 text-2xl text-slate-300">This display link is missing, invalid or has been turned off.<br />Ask the System Administrator for a new link.</p>
          </div>
        </div>
      </Screen>
    )
  }

  const upcoming = groupByDay(q.data?.upcoming ?? [])
  const offline = q.isError && q.data

  return (
    <Screen>
      <header className="flex items-center gap-6 bg-brand px-10 py-5">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white">
          <img src="/dole-emblem.png" alt="DOLE emblem" className="h-14 w-14 object-contain" />
        </span>
        <div className="mr-auto">
          <div className="text-xl font-medium text-white/80">DOLE Vehicle Records System</div>
          <div className="text-4xl font-bold">Trip Schedule{q.data?.office && <span className="font-normal text-white/80"> · {q.data.office.name}</span>}</div>
        </div>
        <div className="text-right">
          <div className="text-6xl leading-none font-bold tabular-nums">{timeFmt.format(now)}</div>
          <div className="mt-2 text-xl text-white/80">{dayFmt.format(now)}</div>
        </div>
      </header>

      {offline && (
        <div role="status" className="flex items-center gap-3 bg-red-700 px-10 py-3 text-2xl font-semibold">
          <WifiOff size={28} aria-hidden="true" /> Connection lost. Showing the schedule from {t(q.data.generated_at)}. Retrying…
        </div>
      )}

      <main className="grid flex-1 grid-cols-3 gap-8 px-10 py-8">
        <section className="col-span-2 flex flex-col">
          <h2 className="mb-4 flex items-baseline justify-between text-3xl font-bold">
            Today
            {pages > 1 && <span className="text-xl font-normal text-slate-400">Page {page + 1} of {pages}</span>}
          </h2>
          {q.isLoading ? <p className="text-2xl text-slate-400">Loading…</p> : today.length === 0 ? (
            <p className="rounded-2xl bg-white/5 p-10 text-center text-3xl text-slate-300">No trips today.</p>
          ) : (
            <table className="w-full text-left">
              <thead className="text-lg tracking-wider text-slate-400 uppercase">
                <tr><th className="pb-3 font-semibold">Time</th><th className="pb-3 font-semibold">Vehicle</th><th className="pb-3 font-semibold">Driver</th><th className="pb-3 font-semibold">Destination</th><th className="pb-3 text-right font-semibold">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {rows.map((r) => {
                  const [time, verb] = timeCell(r)
                  const [label, cls] = STATUS[r.status]
                  return (
                    <tr key={r.ticket_number} className={`text-3xl ${r.status === 'CANCELLED' ? 'text-slate-500 line-through decoration-2' : ''}`}>
                      <td className="py-4 pr-6 whitespace-nowrap"><span className="block text-lg text-slate-400 no-underline">{verb}</span><span className="font-semibold tabular-nums">{time}</span></td>
                      <td className="py-4 pr-6"><span className="block font-bold">{r.plate_number}</span><span className="block text-xl text-slate-400">{r.vehicle_label}</span></td>
                      <td className="py-4 pr-6">{r.driver_name}</td>
                      <td className="max-w-md truncate py-4 pr-6" title={r.destination}>{r.destination}</td>
                      <td className="py-4 text-right whitespace-nowrap">
                        {r.flag && <Pill cls={FLAG[r.flag][1]}>{FLAG[r.flag][0]}</Pill>}
                        <Pill cls={cls}>{label}</Pill>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="flex flex-col rounded-2xl bg-white/5 p-6">
          <h2 className="mb-4 text-3xl font-bold">Coming up</h2>
          {upcoming.length === 0 ? <p className="text-2xl text-slate-400">No trips booked for the next 7 days.</p> : (
            <div className="space-y-6 overflow-hidden">
              {upcoming.slice(0, 5).map(([day, trips]) => (
                <div key={day}>
                  <div className="mb-2 text-xl font-semibold text-amber-300">{day}</div>
                  <ul className="space-y-2">
                    {trips.slice(0, 4).map((r) => (
                      <li key={r.ticket_number} className="flex gap-4 text-2xl">
                        <span className="w-32 shrink-0 font-semibold tabular-nums">{t(r.scheduled_departure)}</span>
                        <span className="min-w-0"><span className="font-bold">{r.plate_number}</span> <span className="text-slate-300">· {r.destination}</span></span>
                      </li>
                    ))}
                    {trips.length > 4 && <li className="text-xl text-slate-400">+{trips.length - 4} more</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="flex justify-between px-10 pb-5 text-lg text-slate-500">
        <span>{q.data?.screen}</span>
        <span>{q.data ? `Updated ${t(q.data.generated_at)} · refreshes every minute` : ''}</span>
      </footer>
    </Screen>
  )
}

function groupByDay(rows) {
  const groups = new Map()
  for (const r of rows) {
    const day = shortDay.format(new Date(r.scheduled_departure))
    if (!groups.has(day)) groups.set(day, [])
    groups.get(day).push(r)
  }
  return [...groups.entries()]
}

// Dark background: easier to read across a room and kinder to TV panels than a white page.
function Screen({ children }) {
  return <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">{children}</div>
}

function Pill({ cls, children }) {
  return <span className={`ml-2 inline-block rounded-full px-4 py-1 text-xl font-bold ${cls}`}>{children}</span>
}
