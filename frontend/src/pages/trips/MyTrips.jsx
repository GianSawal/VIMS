import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Fuel, History, Navigation, Play, Printer } from 'lucide-react'
import { useList } from '../../api'
import { useMe } from '../../auth'
import DateChip from '../../components/DateChip'
import { Button, Modal } from '../../components/ui'
import { VehiclePhoto } from '../vehicles/common'
import { CompleteForm } from './TripDetail'
import { driverWarnings, FuelTripForm, StartTripForm, useDriverHome, Warnings } from './driver'
import { RouteLine, whenText } from './TripList'
import { shortDateTime, tripDuration } from './common'

export const ticketLink = (t, label = 'Print ticket') => (
  <Link to={`/trips/${t.id}/ticket`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
    <Printer size={14} aria-hidden="true" /> {label}
  </Link>
)

const photo = (t) => ({ photo_url: t.vehicle_photo_url, plate_number: t.plate_number, make: '', model: t.vehicle_label })
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }
const today = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })

/** The trip that needs the driver now, big, with its one action. */
function FocusCard({ t, label, tone, children }) {
  return (
    <article className={`space-y-3 rounded-2xl border-2 bg-white p-4 shadow-sm ${tone}`}>
      <div className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{label}</div>
      <div className="flex items-center gap-3">
        <VehiclePhoto vehicle={photo(t)} className="w-24 shrink-0 border border-slate-200" />
        <div className="min-w-0">
          <div className="text-lg font-bold tracking-wide">{t.plate_number}</div>
          <div className="truncate text-sm text-slate-500">{t.vehicle_label}</div>
          <div className="mt-1 font-mono text-xs text-slate-600">{t.ticket_number}</div>
        </div>
      </div>
      <RouteLine t={t} />
      {children}
    </article>
  )
}

/** Driver accounts' landing page: what to do now (start, fuel, return), then what is coming. History has its own page. */
export default function MyTrips() {
  const { data: me } = useMe()
  const home = useDriverHome()
  const out = useList('/trips/', { status: 'DISPATCHED', page_size: 20 })
  const upcoming = useList('/trips/', { status: 'SCHEDULED', ordering: 'scheduled_departure', page_size: 20 })
  const [returning, setReturning] = useState(null)
  const [starting, setStarting] = useState(null)
  const [fueling, setFueling] = useState(null)
  const outNow = out.data?.results ?? []
  const booked = upcoming.data?.results ?? []
  const leavingToday = booked.filter((t) => t.schedule_day === 'TODAY')
  const later = booked.filter((t) => t.schedule_day !== 'TODAY')
  const loading = out.isLoading || upcoming.isLoading

  return (
    <>
      <header className="mb-4">
        <p className="text-sm text-slate-500">{today.format(new Date())}</p>
        <h1 className="text-2xl font-bold text-ink">{greeting()}, {me?.first_name || me?.username}</h1>
      </header>
      <Warnings items={driverWarnings(home.data)} />

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {outNow.map((t) => (
          <FocusCard key={t.id} t={t} label="On the road" tone="border-brand/40">
            <p className="flex items-center gap-1.5 text-sm text-slate-600"><Navigation size={14} aria-hidden="true" className="text-brand" />
              Left {shortDateTime(t.departed_at)} · out {tripDuration(t.departed_at)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setReturning(t)}>Record return</Button>
              <Button variant="secondary" onClick={() => setFueling(t)}><Fuel size={16} aria-hidden="true" /> Add fuel</Button>
              <span className="ml-auto">{ticketLink(t)}</span>
            </div>
          </FocusCard>
        ))}
        {leavingToday.map((t) => (
          <FocusCard key={t.id} t={t} label="Leaves today" tone="border-amber-300">
            <p className="text-sm text-slate-600">{whenText(t)[0]}. The office usually starts it; start it yourself if they have not.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setStarting(t)}><Play size={16} aria-hidden="true" /> Start trip</Button>
              <span className="ml-auto">{ticketLink(t)}</span>
            </div>
          </FocusCard>
        ))}
        {!loading && !outNow.length && !leavingToday.length && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm md:col-span-2">
            <p className="font-semibold text-ink">No trip today.</p>
            <p className="text-sm">{later[0] ? `Next: ${whenText(later[0])[0]} on ${shortDateTime(later[0].scheduled_departure)} to ${later[0].destination}.`
              : 'You will be notified when the office books a trip for you.'}</p>
          </div>
        )}
      </div>

      {later.length > 0 && (
        <section aria-labelledby="booked" className="mb-6">
          <h2 id="booked" className="mb-2 flex items-center gap-2 font-semibold text-ink"><CalendarClock size={16} aria-hidden="true" className="text-gold" /> Coming up</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {later.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 p-4">
                <DateChip value={t.scheduled_departure} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{whenText(t)[0]} · {t.plate_number}</div>
                  <div className="truncate text-sm text-slate-500">To {t.destination}</div>
                </div>
                {ticketLink(t, 'Ticket')}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link to="/my-trips/history" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
        <History size={16} aria-hidden="true" /> All my past trips
      </Link>

      <Modal open={!!starting} onClose={() => setStarting(null)} title={starting ? `Start trip · ${starting.ticket_number}` : ''}>
        {starting && <StartTripForm trip={starting} onClose={() => setStarting(null)} />}
      </Modal>
      <Modal open={!!fueling} onClose={() => setFueling(null)} title={fueling ? `Fuel · ${fueling.ticket_number}` : ''}>
        {fueling && <FuelTripForm trip={fueling} onClose={() => setFueling(null)} />}
      </Modal>
      <Modal open={!!returning} onClose={() => setReturning(null)} title={returning ? `Record return · ${returning.ticket_number}` : ''}>
        {returning && <CompleteForm trip={returning} onClose={() => setReturning(null)} />}
      </Modal>
    </>
  )
}
