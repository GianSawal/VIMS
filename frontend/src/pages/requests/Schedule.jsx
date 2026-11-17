import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { useList } from '../../api'
import { Select } from '../../components/Select'
import { Button, inputBase, PageHeader } from '../../components/ui'

// Requesters' view of how booked their office's vehicles are, from /vehicle-requests/availability/ (times only:
// no vehicle, driver or destination). Same look as the staff TripCalendar. A day is "full" when every
// serviceable vehicle has a trip touching it.
const iso = (d) => d.toLocaleDateString('en-CA')
const clock = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const monthName = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' })
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Every day a slot covers. A trip still out with no expected return counts through today.
function daysOf(slot, today) {
  const start = new Date(slot.start)
  const end = slot.end ? new Date(slot.end) : slot.status === 'DISPATCHED' ? new Date(Math.max(today, start)) : start
  const out = []
  for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) out.push(iso(d))
  return out
}

/** Next 7 days' free vehicles for the requester's (first) office. `onPick(date)` on a day with a free vehicle. */
export function WeekStrip({ onPick }) {
  const [now] = useState(() => new Date())
  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i))
  const q = useList('/vehicle-requests/availability/', { date_from: iso(days[0]), date_to: iso(days[6]) })
  // ponytail: first office only; requesters normally have one. The full schedule page has the office picker.
  const office = q.data?.offices?.[0]
  if (q.isError || (q.data && !office)) return null
  const total = office?.vehicles ?? 0
  const booked = {}
  for (const s of q.data?.slots ?? []) if (s.office === office.id) for (const d of daysOf(s, now)) booked[d] = (booked[d] ?? 0) + 1

  return (
    <section aria-labelledby="week-heading" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="week-heading" className="text-sm font-semibold tracking-wide text-slate-500 uppercase">This week</h2>
        {office && <span className="text-xs text-slate-400">{office.code} · {total} {total === 1 ? 'vehicle' : 'vehicles'}</span>}
        <Link to="/schedule" className="ml-auto inline-flex items-center gap-0.5 text-sm font-medium text-brand hover:underline">Full schedule <ChevronRight size={16} aria-hidden="true" /></Link>
      </div>
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((d, i) => {
          const key = iso(d)
          const free = Math.max(total - (booked[key] ?? 0), 0)
          const tone = !q.data ? 'border-slate-200 bg-slate-50 animate-pulse' : !free ? 'border-red-200 bg-red-50' : free < total ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'
          const label = `${d.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}: ${free} of ${total} vehicles free`
          const body = (
            <>
              <span className="text-[11px] font-medium text-slate-500 uppercase">{i === 0 ? 'Today' : d.toLocaleDateString('en-PH', { weekday: 'short' })}</span>
              <span className="text-lg leading-tight font-bold text-ink tabular-nums sm:text-xl">{d.getDate()}</span>
              {q.data && (
                <span className={`text-[11px] font-semibold ${!free ? 'text-danger' : free < total ? 'text-amber-800' : 'text-green-700'}`}>
                  {free ? <><span className="sm:hidden">{free}</span><span className="hidden sm:inline">{free} free</span></> : 'Full'}
                </span>
              )}
            </>
          )
          const cls = `flex w-full flex-col items-center rounded-xl border px-1 py-2 ${tone}`
          return (
            <li key={key}>
              {onPick && free > 0
                ? <button type="button" aria-label={`${label}. Request a vehicle for this day`} onClick={() => onPick(d)}
                    className={`${cls} transition hover:-translate-y-0.5 hover:shadow-md`}>{body}</button>
                : <div aria-label={label} className={cls}>{body}</div>}
            </li>
          )
        })}
      </ol>
      {onPick && <p className="mt-2 text-xs text-slate-400">Tap a day with a free vehicle to request it.</p>}
    </section>
  )
}

function span(slot, day) {
  const from = iso(new Date(slot.start)) === day ? clock.format(new Date(slot.start)) : 'Earlier'
  const to = !slot.end ? (slot.status === 'DISPATCHED' ? 'not back' : 'open') : iso(new Date(slot.end)) === day ? clock.format(new Date(slot.end)) : 'later'
  return `${from} – ${to}`
}

export default function Schedule() {
  const [now] = useState(() => new Date())
  const [first, setFirst] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [office, setOffice] = useState('')
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay())
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7)
  const days = Array.from({ length: weeks * 7 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i))
  const q = useList('/vehicle-requests/availability/', { date_from: iso(days[0]), date_to: iso(days.at(-1)) })

  const offices = q.data?.offices ?? []
  const current = offices.find((o) => String(o.id) === office) ?? offices[0]
  const total = current?.vehicles ?? 0
  const byDay = {}
  for (const s of q.data?.slots ?? []) {
    if (s.office !== current?.id) continue
    for (const d of daysOf(s, now)) (byDay[d] ??= []).push(s)
  }
  const today = iso(now)
  const shift = (n) => setFirst(new Date(first.getFullYear(), first.getMonth() + n, 1))

  return (
    <div>
      <PageHeader title="Vehicle schedule">See which days already have trips booked before you request a vehicle.</PageHeader>

      {q.isError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">Could not load the schedule. Please refresh the page.</p>
      ) : !q.isLoading && !current ? (
        <p className="rounded-lg bg-white px-4 py-3 text-sm text-slate-500">Your account has no office yet, so there is no schedule to show.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><CalendarDays size={20} aria-hidden="true" /></span>
            <div>
              <h2 className="text-lg leading-tight font-semibold text-ink" aria-live="polite">{monthName.format(first)}</h2>
              <p className="text-xs text-slate-500">{q.isLoading ? 'Loading…' : `${current?.code} · ${total} ${total === 1 ? 'vehicle' : 'vehicles'}`}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-4">
              {offices.length > 1 && (
                <Select aria-label="Office" className={inputBase} value={String(current?.id ?? '')} onChange={(e) => setOffice(e.target.value)}>
                  {offices.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
                </Select>
              )}
              <div className="hidden items-center gap-3 text-xs text-slate-500 sm:flex" aria-hidden="true">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-st-good" />Free</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Some booked</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-danger" />All booked</span>
              </div>
              <div className="flex gap-1">
                <Button variant="secondary" onClick={() => setFirst(new Date(now.getFullYear(), now.getMonth(), 1))}>Today</Button>
                <Button variant="secondary" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={16} /></Button>
                <Button variant="secondary" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={16} /></Button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className={`grid min-w-[52rem] grid-cols-7 ${q.isFetching ? 'opacity-60' : ''}`}>
              {WEEKDAYS.map((d, i) => (
                <div key={d} className={`border-b border-slate-200 px-3 py-2 text-[11px] font-semibold tracking-wider uppercase ${i === 0 || i === 6 ? 'bg-slate-50 text-slate-400' : 'text-slate-500'}`}>{d}</div>
              ))}
              {days.map((d) => {
                const key = iso(d)
                const slots = byDay[key] ?? []
                const free = Math.max(total - slots.length, 0)
                const inMonth = d.getMonth() === first.getMonth()
                const isToday = key === today
                const past = key < today
                const weekend = d.getDay() === 0 || d.getDay() === 6
                const pill = !slots.length ? 'bg-green-50 text-green-700' : free ? 'bg-amber-100 text-amber-800' : 'bg-red-50 text-danger'
                return (
                  <div key={key} className={`min-h-32 border-r border-b border-slate-100 p-2 nth-[7n]:border-r-0
                    ${isToday ? 'bg-brand-light/40' : !inMonth ? 'bg-slate-50/70' : weekend ? 'bg-slate-50/40' : ''}`}>
                    <div className="mb-1.5 flex items-center justify-between gap-1">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm tabular-nums
                        ${isToday ? 'bg-brand font-semibold text-white shadow-sm' : inMonth ? (past ? 'text-slate-400' : 'font-medium text-slate-700') : 'text-slate-300'}`}>
                        {d.getDate()}
                      </span>
                      {inMonth && !past && total > 0 && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pill}`}>{free ? `${free} of ${total} free` : 'All booked'}</span>
                      )}
                    </div>
                    <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                      {slots.map((s, i) => (
                        <li key={i} className="rounded-lg border border-l-4 border-slate-200 border-l-amber-500 bg-white p-2 text-xs shadow-sm">
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-700 tabular-nums"><Clock size={12} aria-hidden="true" />{span(s, key)}</span>
                          <div className="text-[11px] text-slate-500">Vehicle booked</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
