import { useSearchParams } from 'react-router-dom'
import { CircleCheck, Milestone, Navigation, Route as RouteIcon } from 'lucide-react'
import { useList } from '../../api'
import DataTable from '../../components/DataTable'
import DateChip from '../../components/DateChip'
import { useSetParam } from '../../components/filters'
import { inputBase, PageHeader } from '../../components/ui'
import { ticketLink } from './MyTrips'
import { RouteLine, whenText } from './TripList'
import { km, TripStatusBadge } from './common'

const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7)
const monthRange = (m) => {
  const [y, mo] = m.split('-').map(Number)
  const last = new Date(y, mo, 0).getDate()
  return { date_from: `${m}-01`, date_to: `${m}-${String(last).padStart(2, '0')}` }
}

/** A driver's own trips, one month at a time (month in the URL). */
export default function MyTripHistory() {
  const [params, setParams] = useSearchParams()
  const setParam = useSetParam(setParams)
  const month = params.get('month') || thisMonth()
  const page = Number(params.get('page') ?? 1)
  const range = monthRange(month)
  const history = useList('/trips/', { page, ...range })
  const summary = useList('/trips/summary/', range)
  const s = summary.data

  return (
    <>
      <PageHeader title="Trip history">Your trips, one month at a time. Print any trip ticket from here.</PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">Month
          <input type="month" className={inputBase} value={month} max={thisMonth()} onChange={(e) => setParam('month', e.target.value || thisMonth())} />
        </label>
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy={summary.isLoading}>
        {[[RouteIcon, 'bg-brand-light text-brand', 'Trips', s?.total],
          [CircleCheck, 'bg-green-50 text-green-700', 'Completed', s?.by_status.COMPLETED],
          [Navigation, 'bg-sky-50 text-sky-700', 'On the road', s?.by_status.DISPATCHED],
          [Milestone, 'bg-amber-50 text-amber-700', 'Distance', s && km(s.distance_km)]].map(([Icon, tint, label, value]) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tint}`}><Icon size={18} aria-hidden="true" /></span>
            <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="truncate text-lg font-bold tabular-nums">{value ?? '…'}</dd></div>
          </div>
        ))}
      </dl>
      <DataTable label="Trip history" query={history} page={page} onPage={(p) => setParam('page', p)}
        empty="No trips in this month. Pick another month above."
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
          { key: 'ticket', label: <span className="sr-only">Ticket</span>, className: 'w-px whitespace-nowrap', render: (t) => ticketLink(t, 'Print') },
        ]}
        mobileCard={(t) => (
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <DateChip value={t.departed_at ?? t.scheduled_departure} muted={t.status === 'CANCELLED'} />
              <div className="min-w-0 flex-1"><div className="font-medium">{t.plate_number} · {whenText(t)[0]}</div><div className="font-mono text-xs text-slate-500">{t.ticket_number}</div></div>
              <TripStatusBadge status={t.status} />
            </div>
            <RouteLine t={t} />
            <div className="flex items-center justify-between text-sm text-slate-600">{t.distance_km != null ? km(t.distance_km) : <span />}{ticketLink(t, 'Ticket')}</div>
          </div>
        )} />
    </>
  )
}
