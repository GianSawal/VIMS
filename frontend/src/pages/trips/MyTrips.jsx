import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { CalendarClock, ChevronRight, CircleCheck, Fuel, Gauge, History, IdCard, Milestone, Navigation, Play, Printer, UserRound, Users } from 'lucide-react'
import { useList } from '../../api'
import { useMe } from '../../auth'
import DateChip from '../../components/DateChip'
import { initials } from '../../components/filters'
import { EASE_OUT } from '../../components/motion'
import { Button, Modal } from '../../components/ui'
import { VehiclePhoto } from '../vehicles/common'
import { LatestNotifications } from '../requests/MyRequests'
import { CompleteForm } from './TripDetail'
import { driverWarnings, FuelTripForm, licenseText, StartTripForm, useDriverHome, VehicleCard, Warnings } from './driver'
import { RouteLine, whenText } from './TripList'
import { DivisionTag, km, shortDateTime, tripDuration } from './common'

export const ticketLink = (t, label = 'Print ticket') => (
  <Link to={`/trips/${t.id}/ticket`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
    <Printer size={14} aria-hidden="true" /> {label}
  </Link>
)

const photo = (t) => ({ photo_url: t.vehicle_photo_url, plate_number: t.plate_number, make: '', model: t.vehicle_label })
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }
const longDate = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const rise = (i) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, delay: i * 0.06, ease: EASE_OUT } })

function Fact({ icon: Icon, label, children }) {
  if (!children) return null
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm">
      <Icon size={15} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0"><span className="text-slate-500">{label}: </span><span className="font-medium break-words">{children}</span></div>
    </div>
  )
}

/** The trip that needs the driver now, with everything they need on the road and its one action. */
function FocusCard({ t, label, tone, children }) {
  const late = t.status === 'DISPATCHED' && t.scheduled_return && new Date(t.scheduled_return) < new Date()
  return (
    <article className={`space-y-4 rounded-2xl border-2 bg-white p-4 shadow-sm ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{label}</span>
        <span className="font-mono text-xs text-slate-600">{t.ticket_number}</span>
      </div>
      <div className="flex items-center gap-3">
        <VehiclePhoto vehicle={photo(t)} className="w-24 shrink-0 border border-slate-200" />
        <div className="min-w-0">
          <div className="text-lg font-bold tracking-wide">{t.plate_number}</div>
          <div className="truncate text-sm text-slate-500">{t.vehicle_label}</div>
        </div>
      </div>
      <RouteLine t={t} />
      <div className="grid gap-1.5 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
        <Fact icon={UserRound} label="Purpose">{t.purpose}</Fact>
        <Fact icon={Users} label="Passengers">{t.passengers}</Fact>
        <Fact icon={IdCard} label="For">{[t.requesting_office_name, t.requesting_division].filter(Boolean).join(' · ')}</Fact>
        <Fact icon={Gauge} label="Odometer out">{t.odometer_start != null && km(t.odometer_start)}</Fact>
        <Fact icon={CalendarClock} label="Expected back">{t.scheduled_return && shortDateTime(t.scheduled_return)}</Fact>
      </div>
      {late && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">Past the expected return time. Record the return as soon as you are back.</p>}
      {children}
    </article>
  )
}

const Panel = ({ title, action, children, ...rest }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" {...rest}>
    <div className="mb-2 flex items-center">
      <h2 className="mr-auto text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>{action}
    </div>
    {children}
  </section>
)

/** Driver accounts' landing page: what to do now (start, fuel, return), what is coming, their vehicle and updates. */
export default function MyTrips() {
  const { data: me } = useMe()
  const home = useDriverHome()
  const out = useList('/trips/', { status: 'DISPATCHED', page_size: 20 })
  const upcoming = useList('/trips/', { status: 'SCHEDULED', ordering: 'scheduled_departure', page_size: 20 })
  const recent = useList('/trips/', { status: 'COMPLETED', page_size: 3 })
  const [returning, setReturning] = useState(null)
  const [starting, setStarting] = useState(null)
  const [fueling, setFueling] = useState(null)
  const outNow = out.data?.results ?? []
  const booked = upcoming.data?.results ?? []
  const leavingToday = booked.filter((t) => t.schedule_day === 'TODAY')
  const later = booked.filter((t) => t.schedule_day !== 'TODAY')
  const loading = out.isLoading || upcoming.isLoading
  const h = home.data
  const status = outNow.length ? `You are on the road with ${outNow[0].plate_number}.`
    : leavingToday.length ? `You leave today at ${whenText(leavingToday[0])[0].replace('Leaves ', '')}.`
    : later[0] ? `Next trip: ${shortDateTime(later[0].scheduled_departure)}.` : 'No trips booked for you yet.'

  return (
    <div className="space-y-5">
      <motion.header {...rise(0)} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-dark px-5 py-6 text-white shadow-lg shadow-brand/20 sm:px-8">
        <img src="/dole-logo.png" alt="" aria-hidden="true" className="pointer-events-none absolute -top-6 -right-6 h-44 w-44 opacity-10" />
        <div className="relative flex items-center gap-4">
          {h?.driver && (h.driver.photo_url
            ? <img src={h.driver.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-2 ring-white/70 sm:h-20 sm:w-20" />
            : <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-xl font-bold ring-2 ring-white/40 sm:h-20 sm:w-20">{initials(h.driver.full_name)}</span>)}
          <div className="min-w-0">
            <p className="text-sm text-white/70">{longDate.format(new Date())}</p>
            <h1 className="mt-0.5 text-2xl font-bold sm:text-3xl">{greeting()}, {me?.first_name || me?.username}</h1>
            <p className="mt-0.5 text-white/85">{status}</p>
          </div>
        </div>
        {h?.driver && (
          <dl className="relative mt-4 grid grid-cols-3 gap-2">
            {[[Milestone, 'Trips this month', h.month.trips], [Gauge, 'Km this month', h.month.distance_km.toLocaleString('en-PH')],
              [IdCard, 'License', licenseText(h.driver)]].map(([Icon, label, value]) => (
              <div key={label} className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15 ring-inset">
                <dt className="flex items-center gap-1 text-[11px] text-white/70"><Icon size={12} aria-hidden="true" /> {label}</dt>
                <dd className="truncate text-lg font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </motion.header>

      <Warnings items={driverWarnings(h)} />

      <div className="grid gap-5 lg:grid-cols-3">
        <motion.div {...rise(1)} className="space-y-5 lg:col-span-2">
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
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand"><CalendarClock size={20} aria-hidden="true" /></span>
              <div>
                <p className="font-semibold text-ink">No trip today.</p>
                <p className="text-sm text-slate-600">{later[0] ? `Next: ${shortDateTime(later[0].scheduled_departure)} to ${later[0].destination}.`
                  : 'You will be notified when the office books a trip for you.'}</p>
              </div>
            </div>
          )}

          <Panel title="Coming up" aria-label="Coming up">
            {later.length ? (
              <ul className="divide-y divide-slate-100">
                {later.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <DateChip value={t.scheduled_departure} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{whenText(t)[0]} · {t.plate_number}</div>
                      <div className="flex items-center gap-1.5 truncate text-sm text-slate-500"><DivisionTag division={t.requesting_division} /> To {t.destination}</div>
                    </div>
                    {ticketLink(t, 'Ticket')}
                  </li>
                ))}
              </ul>
            ) : <p className="py-2 text-sm text-slate-500">Nothing else booked. New trips appear here and in your notifications.</p>}
          </Panel>

          <Panel title="Recently completed" aria-label="Recently completed"
            action={<Link to="/my-trips/history" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"><History size={14} aria-hidden="true" /> All trips</Link>}>
            {(recent.data?.results ?? []).length ? (
              <ul className="divide-y divide-slate-100">
                {recent.data.results.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <CircleCheck size={18} className="shrink-0 text-green-700" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.destination}</div>
                      <div className="text-xs text-slate-500">{shortDateTime(t.departed_at)} · {t.plate_number}</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-brand-light px-2.5 py-0.5 text-sm font-semibold text-brand tabular-nums">{km(t.distance_km)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="py-2 text-sm text-slate-500">Completed trips will show here.</p>}
          </Panel>
        </motion.div>

        <motion.div {...rise(2)} className="space-y-5">
          {h?.vehicles?.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">My vehicle{h.vehicles.length === 1 ? '' : 's'}</h2>
              {h.vehicles.map((v) => <VehicleCard key={v.id} v={v} />)}
            </div>
          )}
          <LatestNotifications empty="Nothing yet. Trips booked or changed for you show here." />
          <nav aria-label="Shortcuts" className="grid grid-cols-2 gap-3">
            {[['/my-trips/history', History, 'Trip history'], ['/my-profile', UserRound, 'My profile']].map(([to, Icon, label]) => (
              <Link key={to} to={to} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium shadow-sm hover:border-brand hover:text-brand">
                <Icon size={18} className="text-brand" aria-hidden="true" /> <span className="mr-auto">{label}</span><ChevronRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </motion.div>
      </div>

      <Modal open={!!starting} onClose={() => setStarting(null)} title={starting ? `Start trip · ${starting.ticket_number}` : ''}>
        {starting && <StartTripForm trip={starting} onClose={() => setStarting(null)} />}
      </Modal>
      <Modal open={!!fueling} onClose={() => setFueling(null)} title={fueling ? `Fuel · ${fueling.ticket_number}` : ''}>
        {fueling && <FuelTripForm trip={fueling} onClose={() => setFueling(null)} />}
      </Modal>
      <Modal open={!!returning} onClose={() => setReturning(null)} title={returning ? `Record return · ${returning.ticket_number}` : ''}>
        {returning && <CompleteForm trip={returning} onClose={() => setReturning(null)} />}
      </Modal>
    </div>
  )
}
