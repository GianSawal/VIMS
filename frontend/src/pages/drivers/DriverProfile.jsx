import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { api, errorMessage, useList } from '../../api'
import { useCan } from '../../auth'
import Attachments from '../../components/Attachments'
import DataTable from '../../components/DataTable'
import { Badge, Button, formatDateTime, Modal } from '../../components/ui'
import { NotFound } from '../Errors'
import { formatDate } from '../vehicles/common'
import DriverForm from './DriverForm'
import { LicenseBadge } from './common'

export default function DriverProfile() {
  const { id } = useParams()
  const can = useCan()
  const [editing, setEditing] = useState(false)
  const query = useQuery({
    queryKey: ['/drivers/', id],
    queryFn: () => api.get(`/drivers/${id}/`).then((r) => r.data),
  })
  const d = query.data

  if (query.isLoading) return <div className="animate-pulse space-y-3"><div className="h-8 w-56 rounded bg-slate-200" /><div className="h-48 rounded-lg bg-slate-200" /></div>
  if (query.error?.response?.status === 404) return <NotFound />
  if (query.isError) return <div className="text-danger">{errorMessage(query.error)}</div>

  const details = [
    ['Employee number', d.employee_number ?? '—'],
    ['Office', d.office_name],
    ['Contact number', d.contact_number || '—'],
    ['License number', d.license_number],
    ['License type', d.license_type_display],
    ['Restrictions', d.license_restrictions || '—'],
    ['Issued', formatDate(d.license_issue_date)],
    ['Expires', formatDate(d.license_expiry_date)],
  ]

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/drivers" className="hover:underline">Drivers</Link> / <span aria-current="page">{d.full_name}</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-brand">{d.full_name}</h1>
            <Badge tone={d.is_active ? 'green' : 'gray'}>{d.is_active ? 'Active' : 'Inactive'}</Badge>
            <LicenseBadge status={d.license_status} />
          </div>
        </div>
        {can('fleet.change_driver') && (
          <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} /> Edit</Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-brand">Driver details</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {details.map(([l, v]) => (
              <div key={l}><dt className="text-slate-500">{l}</dt><dd className="font-medium">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-400">Last updated {formatDateTime(d.updated_at)}</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-brand">Current vehicle</h2>
          {d.current_vehicles.length ? (
            <ul className="space-y-1 text-sm">
              {d.current_vehicles.map((v) => (
                <li key={v.assignment_id}><Link to={`/vehicles/${v.vehicle_id}`} className="font-medium text-brand hover:underline">{v.plate_number}</Link></li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Not assigned to a vehicle.</p>}
        </section>
      </div>

      <div className="mt-4"><Attachments basePath={`/drivers/${d.id}`} canChange={can('fleet.change_driver')} title="License scans and attachments" /></div>
      <History driverId={id} />

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${d.full_name}`} wide>
        {editing && <DriverForm driver={d} onClose={() => setEditing(false)} />}
      </Modal>
    </div>
  )
}

function History({ driverId }) {
  const [page, setPage] = useState(1)
  const query = useList(`/drivers/${driverId}/assignments/`, { page })
  const columns = [
    { key: 'plate', label: 'Vehicle', render: (a) => <Link to={`/vehicles/${a.vehicle}`} className="font-semibold text-brand hover:underline">{a.plate_number}</Link> },
    { key: 'office', label: 'Office', render: (a) => a.office_code },
    { key: 'accountable_person', label: 'Accountable person' },
    { key: 'start_date', label: 'From', render: (a) => formatDate(a.start_date) },
    { key: 'end_date', label: 'To', render: (a) => a.end_date ? formatDate(a.end_date) : '—' },
    { key: 'status', label: 'Status', render: (a) => <Badge tone={a.is_current ? 'green' : 'gray'}>{a.is_current ? 'Current' : 'Ended'}</Badge> },
  ]
  return (
    <section className="mt-4">
      <h2 className="mb-2 text-sm font-semibold text-brand">Assignment history</h2>
      <DataTable columns={columns} query={query} page={page} onPage={setPage} empty="This driver has not been assigned to a vehicle yet." />
    </section>
  )
}
