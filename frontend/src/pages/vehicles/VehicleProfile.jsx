import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, ArchiveRestore, Building2, CalendarDays, Droplet, Gauge, History, IdCard, Palette, Pencil, Route as RouteIcon, UserRound,
} from 'lucide-react'
import { api, errorMessage, useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { initials } from '../../components/filters'
import PhotoUpload from '../../components/PhotoUpload'
import { Button, ConfirmDialog, formatDateTime } from '../../components/ui'
import { useToast } from '../../components/toast'
import { NotFound } from '../Errors'
import { fuelColumns } from '../fuel/FuelList'
import { tripColumns } from '../trips/TripList'
import AssignmentsTab from './AssignmentsTab'
import FuelTab from './FuelTab'
import TripsTab from './TripsTab'
import { duration, formatDate, formatKm, formatPeso, fuelLabel, StatusBadge, VehiclePhoto } from './common'

// `phase` marks tabs whose module isn't built yet.
const TABS = [
  ['overview', 'Overview'],
  ['assignments', 'Assignments'],
  ['trips', 'Trips'],
  ['fuel', 'Fuel'],
  ['maintenance', 'Maintenance', 8],
  ['documents', 'Documents', 9],
  ['rfid', 'RFID / Toll', 10],
  ['activity', 'Activity', 14],
]

export default function VehicleProfile() {
  const { id } = useParams()
  const can = useCan()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const [confirm, setConfirm] = useState(false)

  const query = useQuery({ queryKey: ['/vehicles/', id], queryFn: () => api.get(`/vehicles/${id}/`).then((r) => r.data) })
  const tripStats = useList('/trips/summary/', { vehicle: id })
  const fuelStats = useList('/fuel-records/summary/', { vehicle: id })
  const fuelLatest = useList('/fuel-records/', { vehicle: id, page_size: 1 })
  const v = query.data

  const archive = useMutation({
    mutationFn: () => api.post(`/vehicles/${id}/${v.is_archived ? 'reactivate' : 'archive'}/`),
    onSuccess: ({ data }) => {
      qc.setQueryData(['/vehicles/', id], data)
      qc.invalidateQueries({ queryKey: ['/vehicles/'] })
      toast(data.is_archived ? 'Vehicle archived.' : 'Vehicle reactivated.')
      setConfirm(false)
    },
    onError: (err) => { toast(errorMessage(err), 'error'); setConfirm(false) },
  })

  if (query.isLoading) return <ProfileSkeleton />
  if (query.error?.response?.status === 404) return <NotFound />
  if (query.isError) return <div className="text-danger">{errorMessage(query.error)}</div>

  const canChange = can('fleet.change_vehicle')
  const a = v.current_assignment
  const trips = tripStats.data
  const fuel = fuelStats.data
  const usual = fuelLatest.data?.results[0]?.usual_km_per_liter
  const goto = (key) => setParams(key === 'overview' ? {} : { tab: key }, { replace: true })

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/vehicles" className="hover:underline">Vehicles</Link> / <span aria-current="page">{v.plate_number}</span>
      </nav>

      {/* Hero */}
      <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid md:grid-cols-[22rem_1fr]">
          <div className="border-b border-slate-200 bg-slate-50 p-4 md:border-r md:border-b-0">
            <PhotoUpload basePath={`/vehicles/${v.id}`} detailKey={['/vehicles/', String(v.id)]} listPrefix="/vehicles/"
              photoUrl={v.photo_url} noun="vehicle" current={<VehiclePhoto vehicle={v} className="border border-slate-200" />}
              canChange={can('fleet.manage_vehicle_photo') && canChange && !v.is_archived} />
          </div>
          <div className="flex flex-col p-6">
            <div className="flex flex-wrap items-start gap-3">
              <div className="mr-auto">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-block rounded-md border-2 border-slate-800 bg-white px-3 py-0.5 font-mono text-2xl font-bold tracking-widest text-slate-900" aria-label={`Plate number ${v.plate_number}`}>{v.plate_number}</span>
                  <StatusBadge vehicle={v} />
                </div>
                <h1 className="mt-3 text-2xl font-bold text-ink">{v.make} {v.model} {v.variant}</h1>
              </div>
              {canChange && !v.is_archived && <Button variant="secondary" onClick={() => navigate(`/vehicles/${id}/edit`)}><Pencil size={16} /> Edit</Button>}
              {canChange && (
                <Button variant={v.is_archived ? 'secondary' : 'ghost'} className={v.is_archived ? '' : 'text-danger hover:bg-red-50'} onClick={() => setConfirm(true)}>
                  {v.is_archived ? <><ArchiveRestore size={16} /> Reactivate</> : <><Archive size={16} /> Archive</>}
                </Button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {[v.year_model && ['Year', v.year_model], ['Type', v.vehicle_type_display], ['Fuel', fuelLabel[v.fuel_type]], v.color && ['Color', v.color]]
                .filter(Boolean).map(([k, val]) => (
                  <span key={k} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700"><span className="text-slate-500">{k}</span> <strong className="font-medium">{val}</strong></span>
                ))}
            </div>

            <dl className="mt-auto grid gap-4 pt-6 text-sm sm:grid-cols-3">
              <Fact icon={Building2} label="Owning office" value={v.office_name} />
              <Fact icon={UserRound} label="Accountable person" value={a?.accountable_person ?? 'Unassigned'} />
              <Fact icon={IdCard} label="Driver"
                value={a?.driver_id ? <Link to={`/drivers/${a.driver_id}`} className="text-brand hover:underline">{a.driver}</Link> : (a?.driver ?? '—')} />
            </dl>
          </div>
        </div>
      </section>

      {v.is_archived && (
        <div className="mb-4 rounded-md border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-700">
          Archived on {formatDateTime(v.archived_at)}. Records are read-only but stay in history and reports.
        </div>
      )}

      {/* KPI tiles */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Gauge} tint="bg-brand-light text-brand" label="Odometer" value={formatKm(v.current_odometer)} sub="Last recorded reading" />
        <Kpi icon={RouteIcon} tint="bg-green-50 text-green-700" label="Trips completed" value={trips ? trips.by_status.COMPLETED.toLocaleString('en-PH') : '…'}
          sub={trips ? `${formatKm(trips.distance_km)} driven${trips.by_status.DISPATCHED ? ' · out now' : ''}` : ''} />
        <Kpi icon={Droplet} tint="bg-amber-50 text-amber-700" label="Fuel spent" value={fuel ? formatPeso(fuel.amount) : '…'}
          sub={fuel ? `${fuel.count} fill-up${fuel.count === 1 ? '' : 's'}${usual ? ` · ${Number(usual).toFixed(1)} km/L est.` : ''}` : ''} />
        <Kpi icon={CalendarDays} tint="bg-slate-100 text-slate-700" label={a ? 'Assigned for' : 'Assignment'} value={a ? duration(a.start_date) : 'None'}
          sub={a ? `Since ${formatDate(a.start_date)}` : 'Not currently assigned'} />
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Vehicle sections" className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {TABS.map(([key, label, phase]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => goto(key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap ${tab === key ? 'bg-brand text-white shadow-sm' : phase ? 'text-slate-400 hover:bg-slate-50' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'overview' ? <Overview v={v} onGo={goto} navigate={navigate} />
          : tab === 'assignments' ? <AssignmentsTab v={v} />
          : tab === 'trips' ? <TripsTab v={v} />
          : tab === 'fuel' ? <FuelTab v={v} />
          : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
              {TABS.find(([k]) => k === tab)?.[1] ?? 'This section'} arrives in Phase {TABS.find(([k]) => k === tab)?.[2]}.
            </div>
          )}
      </div>

      <ConfirmDialog
        open={confirm}
        title={v.is_archived ? 'Reactivate vehicle' : 'Archive vehicle'}
        message={v.is_archived
          ? `${v.plate_number} will appear in the active vehicle list again.`
          : `${v.plate_number} will be hidden from the active list and become read-only. Its history is kept for reports.`}
        confirmLabel={v.is_archived ? 'Reactivate' : 'Archive'}
        danger={!v.is_archived}
        busy={archive.isPending}
        onConfirm={() => archive.mutate()}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}

function Overview({ v, onGo, navigate }) {
  const a = v.current_assignment
  const trips = useList('/trips/', { vehicle: v.id, page_size: 3 })
  const fuel = useList('/fuel-records/', { vehicle: v.id, page_size: 3 })
  const sections = [
    ['Identification', [
      ['Plate number', v.plate_number], ['Property number', v.property_number],
      ['Engine number', v.engine_number, true], ['Chassis number', v.chassis_number, true],
    ]],
    ['Specifications', [
      ['Make', v.make], ['Model', [v.model, v.variant].filter(Boolean).join(' ')], ['Year model', v.year_model],
      ['Vehicle type', v.vehicle_type_display], ['Fuel type', fuelLabel[v.fuel_type]], ['Color', v.color],
    ]],
    ['Acquisition', [
      ['Date acquired', formatDate(v.acquisition_date)], ['Cost', formatPeso(v.acquisition_cost)],
      ['In service for', v.acquisition_date ? duration(v.acquisition_date) : '—'],
    ]],
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Current assignment" action={<Button variant="ghost" onClick={() => onGo('assignments')}><History size={16} /> View history</Button>}>
          {a ? (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white" aria-hidden="true">{initials(a.accountable_person)}</span>
                <div>
                  <div className="text-xs text-slate-500">Accountable person</div>
                  <div className="font-semibold">{a.accountable_person}</div>
                  <div className="text-sm text-slate-500">{a.office}</div>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-xs text-slate-500"><IdCard size={14} aria-hidden="true" /> Driver</div>
                <div className="font-medium">{a.driver_id ? <Link to={`/drivers/${a.driver_id}`} className="text-brand hover:underline">{a.driver}</Link> : (a.driver ?? '—')}</div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-xs text-slate-500"><CalendarDays size={14} aria-hidden="true" /> Assigned since</div>
                <div className="font-medium">{formatDate(a.start_date)}</div>
                <div className="text-sm text-slate-500">{duration(a.start_date)}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
              Not currently assigned. Open the history to assign this vehicle.
            </div>
          )}
        </Card>

        <Mini title="Latest trips" onAll={() => onGo('trips')}>
          <DataTable columns={tripColumns({ withVehicle: false })} query={trips} footer={false} onRowClick={(t) => navigate(`/trips/${t.id}`)} empty="No trips recorded yet." />
        </Mini>
        <Mini title="Latest fuel" onAll={() => onGo('fuel')}>
          <DataTable columns={fuelColumns({ withVehicle: false })} query={fuel} footer={false} onRowClick={(r) => navigate(`/fuel/${r.id}`)} empty="No fuel records yet." />
        </Mini>
      </div>

      <div className="space-y-4">
        <Card title="Vehicle details">
          <div className="space-y-5">
            {sections.map(([title, rows]) => (
              <section key={title} aria-label={title}>
                <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                  {title === 'Specifications' && <Palette size={12} aria-hidden="true" />}{title}
                </h3>
                <dl>
                  {rows.map(([label, value, mono]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className={`text-right font-medium break-all ${mono ? 'font-mono text-[13px]' : ''}`}>{value || <span className="text-slate-400">—</span>}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </Card>
        {v.remarks && (
          <Card title="Remarks"><p className="text-sm whitespace-pre-line">{v.remarks}</p></Card>
        )}
        <p className="text-xs text-slate-400">Added {formatDateTime(v.created_at)} · Last updated {formatDateTime(v.updated_at)}</p>
      </div>
    </div>
  )
}

function Mini({ title, onAll, children }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-brand">{title}</h2>
        <button type="button" onClick={onAll} className="text-sm text-brand hover:underline">View all</button>
      </div>
      {children}
    </section>
  )
}

function Card({ title, action, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-brand">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Fact({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="truncate font-medium">{value}</dd></div>
    </div>
  )
}

function Kpi({ icon: Icon, tint, label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${tint}`}><Icon size={15} aria-hidden="true" /></span>
        {label}
      </div>
      <div className="mt-2 truncate text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</div>
      <div className="mt-0.5 min-h-4 truncate text-xs text-slate-500">{sub}</div>
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-6 w-40 rounded bg-slate-200" />
      <div className="h-64 rounded-xl bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-slate-200" />)}</div>
    </div>
  )
}
