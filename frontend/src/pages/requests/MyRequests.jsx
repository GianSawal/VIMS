import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { Car, ChevronRight, ClipboardPen, MapPin, Phone, Plus, UserRound } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import { Button, formatDateTime, Modal } from '../../components/ui'
import { PROGRESS, ProgressBadge } from './common'
import RequestForm from './RequestForm'

// The requester's own page: their current request(s) up front with progress and the booked vehicle, then a short
// history. Approvers keep the queue in RequestList.
const ACTIVE = ['PENDING', 'APPROVED', 'DISPATCHED']
const STEPS = [['Submitted'], ['Approved', 'APPROVED'], ['On trip', 'DISPATCHED'], ['Completed', 'COMPLETED']]
const stepOf = (progress) => ({ PENDING: 0, APPROVED: 1, DISPATCHED: 2, COMPLETED: 3 })[progress] ?? 0

const time = (d) => d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
function when(iso) {
  const d = new Date(iso)
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5)
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
    : d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${day} · ${time(d)}`
}
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function MyRequests() {
  const can = useCan()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState('')
  // ponytail: one page of the latest 100; a requester rarely has more. Add paging if the history outgrows it.
  const query = useList('/vehicle-requests/', { page_size: 100 })
  const all = query.data?.results ?? []
  const active = all.filter((r) => ACTIVE.includes(r.progress)).sort((a, b) => new Date(a.needed_at) - new Date(b.needed_at))
  const tabs = PROGRESS.map(([key, label]) => [key, label, all.filter((r) => r.progress === key).length]).filter(([, , n]) => n)
  const shown = tab ? all.filter((r) => r.progress === tab) : all
  const canAdd = can('operations.add_vehiclerequest')

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-brand sm:text-3xl">{greeting()}{me?.first_name ? `, ${me.first_name}` : ''}</h1>
          <p className="text-slate-500">Ask for a vehicle and follow your request until the trip is done.</p>
        </div>
        {canAdd && <Button className="px-5 py-3 text-base shadow-sm" onClick={() => setAdding(true)}><Plus size={18} /> Request a vehicle</Button>}
      </header>

      {query.isLoading ? (
        <div className="h-48 animate-pulse rounded-2xl bg-white/70" />
      ) : query.isError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-danger">Could not load your requests. Please refresh the page.</p>
      ) : all.length === 0 ? (
        <section className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-14 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-light text-brand"><Car size={28} aria-hidden="true" /></span>
          <h2 className="text-lg font-semibold text-ink">No requests yet</h2>
          <p className="mt-1 max-w-sm text-sm text-slate-500">Tell us where you need to go and when. The fleet team books a vehicle and you will be notified.</p>
          {canAdd && <Button className="mt-5 px-5 py-3 text-base" onClick={() => setAdding(true)}><Plus size={18} /> Request a vehicle</Button>}
        </section>
      ) : (
        <>
          {active.length > 0 && (
            <section aria-labelledby="current-heading" className="space-y-3">
              <h2 id="current-heading" className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                {active.length === 1 ? 'Your current request' : `Your current requests (${active.length})`}
              </h2>
              {active.map((r, i) => <CurrentRequest key={r.id} r={r} index={i} />)}
            </section>
          )}

          <section aria-labelledby="all-heading" className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="all-heading" className="mr-auto text-sm font-semibold tracking-wide text-slate-500 uppercase">All requests</h2>
              <div role="tablist" aria-label="Filter by status" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-white p-1 shadow-sm">
                {[['', 'All', all.length], ...tabs].map(([key, label, n]) => (
                  <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition ${tab === key ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    {label} <span className={tab === key ? 'text-white/80' : 'text-slate-400'}>{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link to={`/requests/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                    <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 sm:flex"><ClipboardPen size={18} aria-hidden="true" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{r.destination}</div>
                      <div className="truncate text-xs text-slate-500">
                        {formatDateTime(r.needed_at)} · <span className="font-mono">{r.reference_number}</span>{r.trip ? ` · ${r.trip.plate_number}` : ''}
                      </div>
                    </div>
                    <ProgressBadge progress={r.progress} />
                    <ChevronRight size={18} className="shrink-0 text-slate-300" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Request a vehicle" wide>
        {adding && <RequestForm onClose={() => setAdding(false)} onSaved={(r) => navigate(`/requests/${r.id}`)} />}
      </Modal>
    </div>
  )
}

function CurrentRequest({ r, index }) {
  const step = stepOf(r.progress)
  const t = r.trip
  return (
    <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: index * 0.05 }}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ProgressBadge progress={r.progress} />
            <span className="font-mono text-xs text-slate-500">{r.reference_number}</span>
          </div>
          <p className="mt-3 text-2xl font-bold text-ink sm:text-3xl">{when(r.needed_at)}</p>
          <p className="mt-1 flex items-start gap-1.5 text-slate-600">
            <MapPin size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0"><span className="font-medium text-ink">{r.destination}</span>{r.purpose ? ` · ${r.purpose}` : ''}</span>
          </p>
        </div>

        {/* The booked vehicle, once approved */}
        {t ? (
          <div className="flex items-center gap-4 rounded-xl bg-brand-light/50 p-3 lg:w-80">
            {t.vehicle_photo_url
              ? <img src={t.vehicle_photo_url} alt="" className="h-16 w-24 shrink-0 rounded-lg bg-white object-contain" />
              : <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-white text-brand"><Car size={28} aria-hidden="true" /></span>}
            <div className="min-w-0 text-sm">
              <div className="text-lg font-bold tracking-wide text-ink">{t.plate_number}</div>
              <div className="truncate text-slate-600">{t.vehicle_label}</div>
              <div className="mt-1 flex items-center gap-1 truncate text-slate-600">
                <UserRound size={14} aria-hidden="true" /> {t.driver_name ?? 'Driver to be assigned'}
              </div>
              {t.driver_contact && (
                <a href={`tel:${t.driver_contact}`} className="flex items-center gap-1 text-brand hover:underline"><Phone size={14} aria-hidden="true" /> {t.driver_contact}</a>
              )}
            </div>
          </div>
        ) : (
          <p className="self-center rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 lg:w-80">
            Waiting for the fleet team to approve and book a vehicle. You will get a notification.
          </p>
        )}
      </div>

      {/* Progress: Submitted → Approved → On trip → Completed */}
      <ol className="grid grid-cols-4 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6" aria-label="Progress">
        {STEPS.map(([label], i) => {
          const done = i <= step
          return (
            <li key={label} className="relative flex flex-col items-center text-center" aria-current={i === step ? 'step' : undefined}>
              {i > 0 && <span className={`absolute top-2.5 right-1/2 h-0.5 w-full ${done ? 'bg-brand' : 'bg-slate-200'}`} aria-hidden="true" />}
              <span className={`relative z-10 h-5 w-5 rounded-full border-2 ${done ? 'border-brand bg-brand' : 'border-slate-300 bg-white'} ${i === step ? 'ring-4 ring-brand/15' : ''}`} />
              <span className={`mt-1.5 text-xs ${i === step ? 'font-semibold text-brand' : done ? 'text-ink' : 'text-slate-400'}`}>{label}</span>
            </li>
          )
        })}
      </ol>

      <Link to={`/requests/${r.id}`} className="flex items-center justify-center gap-1 border-t border-slate-100 py-2.5 text-sm font-medium text-brand transition hover:bg-brand-light/40">
        View details <ChevronRight size={16} aria-hidden="true" />
      </Link>
    </motion.article>
  )
}
