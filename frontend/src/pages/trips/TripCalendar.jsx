import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react'
import { useList } from '../../api'
import { Avatar } from '../../components/filters'
import { Button } from '../../components/ui'
import { VehiclePhoto } from '../vehicles/common'

const iso = (d) => d.toLocaleDateString('en-CA')
const clock = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const monthName = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' })
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** First day of `month` (YYYY-MM), or of the current month. */
function monthStart(month) {
  const [y, m] = (month ?? '').split('-').map(Number)
  const now = new Date()
  return y && m ? new Date(y, m - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1)
}

/** Month grid of scheduled trips. `month` is YYYY-MM (kept in the URL by the caller). */
export default function TripCalendar({ month, onMonth, filters, toolbar }) {
  const first = monthStart(month)
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay())
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7)
  const days = Array.from({ length: weeks * 7 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i))

  // ponytail: 500 = API max page size; plenty for one month of bookings.
  const q = useList('/trips/', { ...filters, status: 'SCHEDULED', date_from: iso(days[0]), date_to: iso(days.at(-1)),
    ordering: 'scheduled_departure', page_size: 500 })
  const byDay = Object.groupBy(q.data?.results ?? [], (t) => iso(new Date(t.scheduled_departure)))

  const shift = (n) => onMonth(iso(new Date(first.getFullYear(), first.getMonth() + n, 1)).slice(0, 7))
  const [today] = useState(() => iso(new Date()))

  const trips = q.data?.results ?? []
  const missedCount = trips.filter((t) => t.schedule_day === 'MISSED').length

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {toolbar}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><CalendarDays size={20} aria-hidden="true" /></span>
        <div>
          <h2 className="text-lg leading-tight font-semibold text-ink" aria-live="polite">{monthName.format(first)}</h2>
          <p className="text-xs text-slate-500">
            {q.isLoading ? 'Loading…' : `${q.data?.count ?? 0} scheduled ${q.data?.count === 1 ? 'trip' : 'trips'}`}
            {missedCount > 0 && <span className="font-medium text-danger"> · {missedCount} missed</span>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="hidden items-center gap-3 text-xs text-slate-500 sm:flex" aria-hidden="true">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Booked</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-danger" />Missed</span>
          </div>
          <div className="flex gap-1">
            <Button variant="secondary" onClick={() => onMonth('')}>Today</Button>
            <Button variant="secondary" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={16} /></Button>
            <Button variant="secondary" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={16} /></Button>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[52rem] grid-cols-7">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={`border-b border-slate-200 px-3 py-2 text-[11px] font-semibold tracking-wider uppercase ${i === 0 || i === 6 ? 'bg-slate-50 text-slate-400' : 'text-slate-500'}`}>{d}</div>
          ))}
          {days.map((d) => {
            const key = iso(d)
            const dayTrips = byDay[key] ?? []
            const inMonth = d.getMonth() === first.getMonth()
            const isToday = key === today
            const weekend = d.getDay() === 0 || d.getDay() === 6
            return (
              <div key={key} className={`group min-h-32 border-r border-b border-slate-100 p-2 transition-colors nth-[7n]:border-r-0 hover:bg-slate-50/80
                ${isToday ? 'bg-brand-light/40' : !inMonth ? 'bg-slate-50/70' : weekend ? 'bg-slate-50/40' : ''}`}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm tabular-nums
                    ${isToday ? 'bg-brand font-semibold text-white shadow-sm' : inMonth ? (key < today ? 'text-slate-400' : 'font-medium text-slate-700') : 'text-slate-300'}`}>
                    {d.getDate()}
                  </span>
                  {dayTrips.length > 1 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{dayTrips.length} trips</span>}
                </div>
                <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                  {dayTrips.map((t) => {
                    const missed = t.schedule_day === 'MISSED'
                    return (
                      <li key={t.id}>
                        <Link to={`/trips/${t.id}`} title={`${t.ticket_number} · ${t.driver_name} · to ${t.destination}${missed ? ' · missed' : ''}`}
                          className={`block overflow-hidden rounded-lg border border-l-4 bg-white p-2 text-xs shadow-sm transition hover:-translate-y-px hover:shadow-md
                            ${missed ? 'border-red-200 border-l-danger' : 'border-slate-200 border-l-amber-500'}`}>
                          <div className="mb-1.5 flex items-center justify-between gap-1">
                            <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${missed ? 'text-danger' : 'text-amber-700'}`}>
                              <Clock size={12} aria-hidden="true" />{clock.format(new Date(t.scheduled_departure))}
                            </span>
                            {missed && <span className="rounded bg-red-50 px-1.5 text-[10px] font-semibold text-danger uppercase">Missed</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <VehiclePhoto vehicle={{ photo_url: t.vehicle_photo_url, plate_number: t.plate_number, make: '', model: t.vehicle_label }} className="w-14 shrink-0 border border-slate-200" />
                            <div className="min-w-0">
                              <div className="truncate font-semibold tracking-wide text-ink">{t.plate_number}</div>
                              <div className="flex items-center gap-0.5 truncate text-[11px] text-slate-500"><MapPin size={10} className="shrink-0 text-accent" aria-hidden="true" />{t.destination}</div>
                            </div>
                          </div>
                          <div className="mt-1.5 flex items-center gap-1.5 border-t border-slate-100 pt-1.5">
                            <Avatar name={t.driver_name} src={t.driver_photo_url} className="h-5! w-5! text-[8px]" />
                            <span className="min-w-0 truncate text-[11px] text-slate-600">{t.driver_name}</span>
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
