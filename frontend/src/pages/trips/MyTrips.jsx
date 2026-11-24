import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { CalendarClock, ChevronRight, CircleCheck, Fuel, Gauge, History, IdCard, Milestone, Navigation, Play, Printer, UserRound } from 'lucide-react'
import { useList } from '../../api'
import { useMe } from '../../auth'
import ContourLines from '../../components/ContourLines'
import DateChip from '../../components/DateChip'
import { initials } from '../../components/filters'
import { EASE_OUT } from '../../components/motion'
import { Button, Modal } from '../../components/ui'
import { formatDate, VehiclePhoto } from '../vehicles/common'
import { LatestNotifications } from '../requests/MyRequests'
import { CompleteForm } from './TripDetail'
import { driverWarnings, FuelTripForm, StartTripForm, useDriverHome, VehicleCard, Warnings } from './driver'
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

// Label above value: scans as a column, unlike "Label: value" sentences.
function Fact({ label, wide, children }) {
  if (!children) return null
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words text-ink">{children}</dd>
    </div>
  )
}

/** The trip that needs the driver now, with everything they need on the road and its one action. */
// Passengers are typed one per line (or with commas); show them as a readable list.
const passengerList = (p) => (p || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).join(', ')

function FocusCard({ t, label, tone, when, children }) {
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
          <div className="text-lg leading-tight font-bold tracking-wide">{t.plate_number}</div>
          <div className="truncate text-sm text-slate-500">{t.vehicle_label}</div>
          {when && <div className="mt-1.5 text-sm text-slate-700">{when}</div>}
        </div>
      </div>
      <div className="rounded-xl bg-slate-50 p-3">
        <div className="border-b border-slate-200 pb-3"><RouteLine t={t} /></div> {/* padding outside: it would stretch the route's connector line */}
        <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Fact label="Purpose" wide>{t.purpose}</Fact>
          <Fact label="Passengers" wide>{passengerList(t.passengers)}</Fact>
          <Fact label="Requested by">{[t.requesting_office_name, t.requesting_division].filter(Boolean).join(' · ')}</Fact>
          <Fact label="Odometer out">{t.odometer_start != null && km(t.odometer_start)}</Fact>
          <Fact label="Expected back">{t.scheduled_return && shortDateTime(t.scheduled_return)}</Fact>
        </dl>
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
  const [StatusIcon, status] = outNow.length ? [Navigation, `You are on the road with ${outNow[0].plate_number}.`]
    : leavingToday.length ? [Play, `You leave today at ${whenText(leavingToday[0])[0].replace('Leaves ', '')}.`]
    : later[0] ? [CalendarClock, `Next trip: ${shortDateTime(later[0].scheduled_departure)}.`] : [CalendarClock, 'Nothing scheduled right now.']
  const licenseTint = { VALID: 'text-green-300', EXPIRING: 'text-amber-300', EXPIRED: 'text-red-300' }[h?.driver?.license_status]

  return (
    <div className="space-y-5">
      <motion.header {...rise(0)} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-dark px-5 py-6 text-white shadow-lg shadow-brand/20 sm:px-8">
        <ContourLines />
        <div className="relative flex items-center gap-4">
          {h?.driver && (h.driver.photo_url
            ? <img src={h.driver.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-lg ring-2 ring-gold ring-offset-2 ring-offset-brand sm:h-20 sm:w-20" />
            : <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-xl font-bold shadow-lg ring-2 ring-gold ring-offset-2 ring-offset-brand sm:h-20 sm:w-20">{initials(h.driver.full_name)}</span>)}
          <div className="min-w-0">
            <p className="text-xs text-white/70 sm:text-sm">{longDate.format(new Date())}</p>
            <h1 className="mt-0.5 leading-tight">
              <span className="block text-sm font-medium text-white/85">{greeting()},</span>
              <span className="block text-xl font-bold text-balance break-words sm:text-3xl">{me?.first_name || me?.username}</span>
            </h1>
          </div>
          {/* The logo is mostly the same blue as the banner, so it sits in full colour on a white seal instead of faded into it. */}
          <img src="/dole-logo.png" alt="DOLE" className="ml-auto h-14 w-14 shrink-0 self-start rounded-full bg-white p-1 shadow-lg ring-2 ring-gold/70 sm:h-16 sm:w-16" />
        </div>
        <p className="relative mt-4 inline-flex items-center gap-2 rounded-xl bg-white/15 px-3 py-1.5 text-sm font-medium ring-1 ring-white/20 backdrop-blur-sm">
          <StatusIcon size={15} className="shrink-0 text-gold" aria-hidden="true" /> {status}
        </p>
        {h?.driver && (
          // Short labels that never wrap, the period underneath, so the three tiles line up on a phone.
          <dl className="relative mt-3 grid grid-cols-3 gap-2">
            {[[Milestone, 'Trips', h.month.trips, 'this month'], [Gauge, 'Distance', `${h.month.distance_km.toLocaleString('en-PH')} km`, 'this month'],
              [IdCard, 'License', { VALID: 'Valid', EXPIRING: `${h.driver.license_days_left} days left`, EXPIRED: 'Expired' }[h.driver.license_status], `until ${formatDate(h.driver.license_expiry_date)}`]].map(([Icon, label, value, sub]) => (
              <div key={label} className="min-w-0 rounded-xl bg-white/10 px-3 py-2.5 shadow-sm ring-1 ring-white/15 backdrop-blur-sm ring-inset">
                <dt className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-white/75">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/15"><Icon size={12} aria-hidden="true" /></span> {label}
                </dt>
                <dd className={`mt-1 truncate text-lg leading-snug font-bold tabular-nums ${label === 'License' ? licenseTint : ''}`}>{value}</dd>
                <dd className="truncate text-[11px] text-white/60">{sub}</dd>
              </div>
            ))}
          </dl>
        )}
      </motion.header>

      <Warnings items={driverWarnings(h)} />

      <div className="grid gap-5 lg:grid-cols-3">
        <motion.div {...rise(1)} className="space-y-5 lg:col-span-2">
          {outNow.map((t) => (
            <FocusCard key={t.id} t={t} label="On the road" tone="border-brand/40"
              when={<span className="flex items-start gap-1.5"><Navigation size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
                <span>Left {shortDateTime(t.departed_at)}<br /><strong className="font-semibold text-brand">Out {tripDuration(t.departed_at)}</strong></span></span>}>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setReturning(t)}>Record return</Button>
                <Button variant="secondary" onClick={() => setFueling(t)}><Fuel size={16} aria-hidden="true" /> Add fuel</Button>
                <span className="ml-auto">{ticketLink(t)}</span>
              </div>
            </FocusCard>
          ))}
          {leavingToday.map((t) => (
            <FocusCard key={t.id} t={t} label="Leaves today" tone="border-amber-300"
              when={<strong className="font-semibold text-amber-800">{whenText(t)[0]}</strong>}>
              <p className="text-sm text-slate-600">The office usually starts it; start it yourself if they have not.</p>
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
                      {t.purpose && <div className="mt-0.5 line-clamp-2 text-sm text-slate-700">{t.purpose}</div>}
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
