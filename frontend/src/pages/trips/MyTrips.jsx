import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarClock, Navigation } from 'lucide-react'
import { useList } from '../../api'
import DataTable from '../../components/DataTable'
import DateChip from '../../components/DateChip'
import { useSetParam } from '../../components/filters'
import { Button, Modal, PageHeader } from '../../components/ui'
import { VehiclePhoto } from '../vehicles/common'
import { CompleteForm } from './TripDetail'
import { RouteLine, whenText } from './TripList'
import { km, shortDateTime, tripDuration, TripStatusBadge } from './common'

const photo = (t) => ({ photo_url: t.vehicle_photo_url, plate_number: t.plate_number, make: '', model: t.vehicle_label })

/** Driver accounts' home: the trips this driver drives (the API returns no one else's), and the return form. */
export default function MyTrips() {
  const [params, setParams] = useSearchParams()
  const setParam = useSetParam(setParams)
  const page = Number(params.get('page') ?? 1)
  const out = useList('/trips/', { status: 'DISPATCHED', page_size: 20 })
  const upcoming = useList('/trips/', { status: 'SCHEDULED', ordering: 'scheduled_departure', page_size: 20 })
  const history = useList('/trips/', { page })
  const [returning, setReturning] = useState(null)
  const outNow = out.data?.results ?? []
  const booked = upcoming.data?.results ?? []

  return (
    <>
      <PageHeader title="My trips">Your trips as the driver. Record the return when you are back.</PageHeader>

      {outNow.length > 0 && (
        <section aria-labelledby="out-now" className="mb-6">
          <h2 id="out-now" className="mb-2 flex items-center gap-2 font-semibold text-ink"><Navigation size={16} aria-hidden="true" className="text-brand" /> Out now</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {outNow.map((t) => (
              <article key={t.id} className="space-y-3 rounded-xl border border-brand/30 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <VehiclePhoto vehicle={photo(t)} className="w-20 shrink-0 border border-slate-200" />
                  <div className="min-w-0">
                    <div className="font-semibold tracking-wide">{t.plate_number}</div>
                    <div className="truncate text-xs text-slate-500">{t.vehicle_label}</div>
                    <div className="mt-1 font-mono text-xs text-slate-600">{t.ticket_number}</div>
                  </div>
                </div>
                <RouteLine t={t} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-slate-600">Left {shortDateTime(t.departed_at)} · out {tripDuration(t.departed_at)}</span>
                  <Button onClick={() => setReturning(t)}>Record return</Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {booked.length > 0 && (
        <section aria-labelledby="booked" className="mb-6">
          <h2 id="booked" className="mb-2 flex items-center gap-2 font-semibold text-ink"><CalendarClock size={16} aria-hidden="true" className="text-gold" /> Coming up</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {booked.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 p-4">
                <DateChip value={t.scheduled_departure} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{whenText(t)[0]} · {t.plate_number || 'Vehicle to be assigned'}</div>
                  <div className="truncate text-sm text-slate-500">To {t.destination}</div>
                </div>
                <span className="font-mono text-xs text-slate-500">{t.ticket_number}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="mb-2 font-semibold text-ink">All my trips</h2>
      <DataTable label="My trips" query={history} page={page} onPage={(p) => setParam('page', p)}
        empty="No trips yet. Trips you are assigned to drive will show here."
        columns={[
          { key: 'when', label: 'When', className: 'w-px', render: (t) => (
            <div className="flex items-center gap-3 whitespace-nowrap">
              <DateChip value={t.departed_at ?? t.scheduled_departure} muted={t.status === 'CANCELLED'} />
              <div><div className="font-medium">{whenText(t)[0]}</div><div className="text-xs text-slate-500">{t.ticket_number}</div></div>
            </div>
          ) },
          { key: 'vehicle', label: 'Vehicle', render: (t) => <><div className="font-semibold tracking-wide">{t.plate_number}</div><div className="text-xs text-slate-500">{t.vehicle_label}</div></> },
          { key: 'route', label: 'Route', render: (t) => <RouteLine t={t} className="max-w-72" /> },
          { key: 'distance', label: 'Distance', className: 'w-px whitespace-nowrap text-right', render: (t) => (t.distance_km != null ? km(t.distance_km) : '—') },
          { key: 'status', label: 'Status', className: 'w-px whitespace-nowrap', render: (t) => <TripStatusBadge status={t.status} /> },
        ]}
        mobileCard={(t) => (
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <DateChip value={t.departed_at ?? t.scheduled_departure} muted={t.status === 'CANCELLED'} />
              <div className="min-w-0 flex-1"><div className="font-medium">{t.plate_number} · {whenText(t)[0]}</div><div className="font-mono text-xs text-slate-500">{t.ticket_number}</div></div>
              <TripStatusBadge status={t.status} />
            </div>
            <RouteLine t={t} />
            {t.distance_km != null && <div className="text-sm text-slate-600">{km(t.distance_km)}</div>}
          </div>
        )} />

      <Modal open={!!returning} onClose={() => setReturning(null)} title={returning ? `Record return · ${returning.ticket_number}` : ''}>
        {returning && <CompleteForm trip={returning} onClose={() => setReturning(null)} />}
      </Modal>
    </>
  )
}
