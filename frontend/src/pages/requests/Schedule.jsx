import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useList } from '../../api'
import { Select } from '../../components/Select'
import { Button, inputBase, PageHeader } from '../../components/ui'

// Requesters' view of how booked their office's vehicles are, from /vehicle-requests/availability/ (times only:
// no vehicle, driver or destination). A day is "full" when every serviceable vehicle has a trip touching it.
const pad = (n) => String(n).padStart(2, '0')
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const time = (iso) => new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Every day key a slot covers. A trip still out with no expected return counts through today.
function daysOf(slot, today) {
  const start = new Date(slot.start)
  const end = slot.end ? new Date(slot.end) : slot.status === 'DISPATCHED' ? new Date(Math.max(today, start)) : start
  const out = []
  for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d = addDays(d, 1)) out.push(key(d))
  return out
}

function span(slot, day) {
  const s = new Date(slot.start), e = slot.end && new Date(slot.end)
  const from = key(s) === day ? time(slot.start) : 'Earlier'
  const to = !e ? (slot.status === 'DISPATCHED' ? 'not back yet' : 'return not set') : key(e) === day ? time(slot.end) : 'later'
  return `${from} – ${to}`
}

export default function Schedule() {
  const now = new Date()
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [office, setOffice] = useState('')
  const [picked, setPicked] = useState(key(now))
  const first = addDays(month, -month.getDay())
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i))
  const q = useList('/vehicle-requests/availability/', { date_from: key(days[0]), date_to: key(days[41]) })

  const offices = q.data?.offices ?? []
  const current = offices.find((o) => String(o.id) === office) ?? offices[0]
  const byDay = {}
  for (const s of q.data?.slots ?? []) {
    if (s.office !== current?.id) continue
    for (const d of daysOf(s, now)) (byDay[d] ??= []).push(s)
  }
  const total = current?.vehicles ?? 0
  const today = key(now)

  function tone(d) {
    const booked = byDay[key(d)]?.length ?? 0
    if (!booked) return 'bg-white'
    return booked >= total ? 'bg-red-50' : 'bg-amber-50'
  }

  return (
    <div>
      <PageHeader title="Vehicle schedule">See which days already have trips booked before you request a vehicle.</PageHeader>

      {q.isError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">Could not load the schedule. Please refresh the page.</p>
      ) : !q.isLoading && !current ? (
        <p className="rounded-lg bg-white px-4 py-3 text-sm text-slate-500">Your account has no office yet, so there is no schedule to show.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></Button>
              <h2 className="min-w-36 text-center font-semibold text-ink">{month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</h2>
              <Button variant="secondary" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></Button>
              {offices.length > 1 && (
                <Select aria-label="Office" className={`${inputBase} ml-auto`} value={String(current?.id ?? '')} onChange={(e) => setOffice(e.target.value)}>
                  {offices.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
                </Select>
              )}
            </div>
            <div className={`grid grid-cols-7 gap-1 text-center text-xs ${q.isFetching ? 'opacity-60' : ''}`}>
              {WEEKDAYS.map((w) => <div key={w} className="py-1 font-medium text-slate-500">{w}</div>)}
              {days.map((d) => {
                const k = key(d)
                const booked = byDay[k]?.length ?? 0
                const free = Math.max(total - booked, 0)
                return (
                  <button key={k} type="button" onClick={() => setPicked(k)} aria-pressed={picked === k}
                    aria-label={`${d.toDateString()}: ${booked} booked, ${free} of ${total} free`}
                    className={`flex min-h-16 flex-col items-center rounded-lg p-1 ring-1 ring-slate-200 ${tone(d)}
                      ${d.getMonth() !== month.getMonth() ? 'opacity-40' : ''} ${picked === k ? 'ring-2 ring-brand' : ''}`}>
                    <span className={`text-sm ${k === today ? 'rounded-full bg-brand px-1.5 font-bold text-white' : 'text-ink'}`}>{d.getDate()}</span>
                    {booked > 0 && <span className="mt-auto text-[11px] leading-tight text-slate-600">{booked} booked</span>}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <span><span className="mr-1 inline-block h-3 w-3 rounded ring-1 ring-slate-300" />All {total} vehicles free</span>
              <span><span className="mr-1 inline-block h-3 w-3 rounded bg-amber-50 ring-1 ring-slate-300" />Some booked</span>
              <span><span className="mr-1 inline-block h-3 w-3 rounded bg-red-50 ring-1 ring-slate-300" />All booked</span>
            </p>
          </section>

          <aside className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-semibold text-ink">{new Date(`${picked}T00:00`).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
            <p className="mb-3 text-sm text-slate-500">{Math.max(total - (byDay[picked]?.length ?? 0), 0)} of {total} vehicles free</p>
            {byDay[picked]?.length ? (
              <ul className="space-y-2 text-sm">
                {byDay[picked].map((s, i) => <li key={i} className="rounded-lg bg-pearl px-3 py-2 text-ink">Vehicle booked · {span(s, picked)}</li>)}
              </ul>
            ) : <p className="text-sm text-slate-500">No trips booked.</p>}
          </aside>
        </div>
      )}
    </div>
  )
}
