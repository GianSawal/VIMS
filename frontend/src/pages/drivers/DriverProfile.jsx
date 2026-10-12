import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Building2, Car, CircleCheck, IdCard, Milestone, Pencil, Phone, ShieldAlert, ShieldCheck } from 'lucide-react'
import { api, errorMessage, useList } from '../../api'
import { useCan } from '../../auth'
import Attachments from '../../components/Attachments'
import DataTable from '../../components/DataTable'
import { initials } from '../../components/filters'
import PhotoUpload from '../../components/PhotoUpload'
import { Badge, Button, formatDateTime, Modal } from '../../components/ui'
import { NotFound } from '../Errors'
import { tripColumns } from '../trips/TripList'
import { duration, formatDate, formatKm } from '../vehicles/common'
import DriverForm from './DriverForm'
import { expiryNote, LicenseBadge, todayISO } from './common'

export default function DriverProfile() {
  const { id } = useParams()
  const can = useCan()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const query = useQuery({ queryKey: ['/drivers/', id], queryFn: () => api.get(`/drivers/${id}/`).then((r) => r.data) })
  const trips = useList('/trips/summary/', { driver: id })
  const d = query.data

  if (query.isLoading) return <div className="animate-pulse space-y-4"><div className="h-44 rounded-xl bg-slate-200" /><div className="h-24 rounded-xl bg-slate-200" /></div>
  if (query.error?.response?.status === 404) return <NotFound />
  if (query.isError) return <div className="text-danger">{errorMessage(query.error)}</div>

  const canChange = can('fleet.change_driver')
  const t = trips.data
  const vehicle = d.current_vehicles[0]

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/drivers" className="hover:underline">Drivers</Link> / <span aria-current="page">{d.full_name}</span>
      </nav>

      {/* Header card */}
      <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="h-16 bg-gradient-to-r from-brand to-brand-dark" aria-hidden="true" />
        <div className="flex flex-col gap-5 px-6 pb-6 sm:flex-row">
          <div className="-mt-10 w-36 shrink-0">
            <PhotoUpload basePath={`/drivers/${d.id}`} detailKey={['/drivers/', id]} listPrefix="/drivers/"
              photoUrl={d.photo_url} noun="driver" frame="aspect-square" canChange={canChange}
              current={d.photo_url
                ? <img src={d.photo_url} alt={`Photo of ${d.full_name}`} className="aspect-square w-full rounded-xl object-cover ring-4 ring-white shadow-md" />
                : <div className="flex aspect-square items-center justify-center rounded-xl bg-brand-light text-5xl font-bold text-brand ring-4 ring-white shadow-md" role="img" aria-label="No photo">{initials(d.full_name)}</div>} />
          </div>
          <div className="min-w-0 flex-1 pt-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="mr-auto">
                <h1 className="text-2xl font-bold text-ink">{d.full_name}</h1>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <Badge tone={d.is_active ? 'green' : 'gray'} dot>{d.is_active ? 'Active driver' : 'Inactive'}</Badge>
                  <LicenseBadge status={d.license_status} />
                  <Badge tone="blue">{d.license_type_display} license</Badge>
                </div>
              </div>
              {canChange && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} /> Edit</Button>}
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <Meta icon={IdCard} label="Employee no." value={d.employee_number ?? 'Not recorded'} />
              <Meta icon={Building2} label="Office" value={d.office_name} />
              <Meta icon={Phone} label="Contact" value={d.contact_number || 'Not recorded'} />
            </dl>
          </div>
        </div>
      </section>

      {/* Stat tiles */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={d.license_status === 'VALID' ? ShieldCheck : ShieldAlert}
          tint={{ VALID: 'bg-green-50 text-green-700', EXPIRING: 'bg-amber-50 text-amber-700', EXPIRED: 'bg-red-50 text-danger' }[d.license_status]}
          label="License expires" value={formatDate(d.license_expiry_date)} sub={expiryNote(d.license_expiry_date)} />
        <Stat icon={Car} tint="bg-brand-light text-brand" label="Current vehicle"
          value={vehicle ? <Link to={`/vehicles/${vehicle.vehicle_id}`} className="text-brand hover:underline">{vehicle.plate_number}</Link> : 'Unassigned'}
          sub={d.current_vehicles.length > 1 ? `+${d.current_vehicles.length - 1} more` : vehicle ? 'Assigned driver' : 'No current assignment'} />
        <Stat icon={CircleCheck} tint="bg-green-50 text-green-700" label="Trips completed"
          value={t ? t.by_status.COMPLETED.toLocaleString('en-PH') : '…'}
          sub={t ? `${t.by_status.DISPATCHED ? 'On a trip now · ' : ''}${t.by_status.SCHEDULED} scheduled` : ''} />
        <Stat icon={Milestone} tint="bg-amber-50 text-amber-700" label="Distance driven" value={t ? formatKm(t.distance_km) : '…'} sub="Completed trips" />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <LicenseCard d={d} />
        <section className="lg:col-span-2" aria-labelledby="trips-title">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="trips-title" className="font-semibold text-ink">Recent trips</h2>
            {t?.total > 5 && <Link to={`/trips?search=${encodeURIComponent(d.full_name)}`} className="text-sm text-brand hover:underline">View all {t.total}</Link>}
          </div>
          <RecentTrips driverId={id} onOpen={(trip) => navigate(`/trips/${trip.id}`)} />
        </section>
      </div>

      <div className="mb-4"><Attachments basePath={`/drivers/${d.id}`} canChange={canChange} title="License scans and attachments" /></div>
      <History driverId={id} />
      <p className="mt-4 text-xs text-slate-400">Profile updated {formatDateTime(d.updated_at)}</p>

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${d.full_name}`} wide>
        {editing && <DriverForm driver={d} onClose={() => setEditing(false)} />}
      </Modal>
    </div>
  )
}

/** License shown as a card, with how much of its validity period has been used. */
function LicenseCard({ d }) {
  const issued = d.license_issue_date ? new Date(`${d.license_issue_date}T00:00:00`) : null
  const expires = new Date(`${d.license_expiry_date}T00:00:00`)
  const today = new Date(`${todayISO()}T00:00:00`)
  const used = issued && expires > issued ? Math.min(100, Math.max(0, ((today - issued) / (expires - issued)) * 100)) : null
  const bar = { VALID: 'bg-green-400', EXPIRING: 'bg-amber-400', EXPIRED: 'bg-red-400' }[d.license_status]

  return (
    <section aria-label="Driver's license" className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white shadow-md">
      <div aria-hidden="true" className="pointer-events-none absolute -top-10 -right-10 h-36 w-36 rotate-12 bg-white/10 [clip-path:polygon(50%_0,100%_100%,0_100%)]" />
      <div className="relative flex items-center justify-between">
        <span className="text-xs font-semibold tracking-widest text-white/75 uppercase">Driver&apos;s license</span>
        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium">{d.license_type_display}</span>
      </div>
      <div className="relative mt-4 font-mono text-2xl font-bold tracking-wider">{d.license_number}</div>
      <div className="relative mt-1 text-sm text-white/80">{d.full_name}</div>
      <dl className="relative mt-5 grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-[11px] text-white/65 uppercase">Restrictions</dt><dd className="font-semibold">{d.license_restrictions || '—'}</dd></div>
        <div><dt className="text-[11px] text-white/65 uppercase">Issued</dt><dd className="font-semibold">{issued ? formatDate(d.license_issue_date) : '—'}</dd></div>
        <div><dt className="text-[11px] text-white/65 uppercase">Expires</dt><dd className="font-semibold">{formatDate(d.license_expiry_date)}</dd></div>
      </dl>
      <div className="relative mt-5">
        {used != null && (
          <div className="h-2 overflow-hidden rounded-full bg-white/20" role="meter" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100} aria-label="Validity used">
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${used}%` }} />
          </div>
        )}
        <p className="mt-2 text-sm font-medium">
          {d.license_status === 'EXPIRED' ? `Expired ${expiryNote(d.license_expiry_date).replace('expired ', '')}` : `Valid for ${duration(todayISO(), d.license_expiry_date)} more`}
        </p>
      </div>
    </section>
  )
}

function RecentTrips({ driverId, onOpen }) {
  const query = useList('/trips/', { driver: driverId, page_size: 5 })
  return <DataTable columns={tripColumns()} query={query} footer={false} onRowClick={onOpen} empty="No trips recorded for this driver yet." />
}

function History({ driverId }) {
  const [page, setPage] = useState(1)
  const query = useList(`/drivers/${driverId}/assignments/`, { page })
  const columns = [
    { key: 'plate', label: 'Vehicle', render: (a) => <Link to={`/vehicles/${a.vehicle}`} className="font-semibold text-brand hover:underline">{a.plate_number}</Link> },
    { key: 'office', label: 'Office', render: (a) => a.office_code },
    { key: 'accountable_person', label: 'Accountable person' },
    { key: 'period', label: 'Period', render: (a) => `${formatDate(a.start_date)} – ${a.end_date ? formatDate(a.end_date) : 'present'}` },
    { key: 'status', label: 'Status', render: (a) => <Badge tone={a.is_current ? 'green' : 'gray'} dot>{a.is_current ? 'Current' : 'Ended'}</Badge> },
  ]
  return (
    <section aria-labelledby="assign-title">
      <h2 id="assign-title" className="mb-2 font-semibold text-ink">Vehicle assignment history</h2>
      <DataTable columns={columns} query={query} page={page} onPage={setPage} empty="This driver has not been assigned to a vehicle yet." />
    </section>
  )
}

function Meta({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="truncate font-medium">{value}</dd></div>
    </div>
  )
}

function Stat({ icon: Icon, tint, label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${tint}`}><Icon size={15} aria-hidden="true" /></span>
        {label}
      </div>
      <div className="mt-2 truncate text-xl font-semibold text-ink">{value}</div>
      <div className="mt-0.5 min-h-4 text-xs text-slate-500">{sub}</div>
    </div>
  )
}
