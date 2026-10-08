import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { Badge, Button, inputClass, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatDate } from '../vehicles/common'
import DriverForm from './DriverForm'
import { LICENSE_STATUSES, LicenseBadge } from './common'

export default function DriverList() {
  const can = useCan()
  const { data: me } = useMe()
  const offices = useAllOffices()
  const [adding, setAdding] = useState(false)
  // Filters live in the URL so dashboard widgets can link here (e.g. /drivers?license_status=EXPIRING).
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const f = Object.fromEntries(params)
  const page = Number(f.page ?? 1)
  const query = useList('/drivers/', {
    page, search: f.search, office: f.office, license_status: f.license_status, is_active: f.is_active,
  })

  const set = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  const columns = [
    { key: 'full_name', label: 'Name', render: (d) => (
      <Link to={`/drivers/${d.id}`} className="font-semibold text-brand hover:underline">{d.full_name}</Link>
    ) },
    { key: 'employee_number', label: 'Employee No.', render: (d) => d.employee_number ?? '—' },
    { key: 'office', label: 'Office', render: (d) => d.office_code },
    { key: 'license_number', label: 'License No.' },
    { key: 'license', label: 'License expiry', render: (d) => (
      <div className="flex flex-col items-start gap-1">
        <span>{formatDate(d.license_expiry_date)}</span>
        <LicenseBadge status={d.license_status} />
      </div>
    ) },
    { key: 'vehicles', label: 'Current vehicle', render: (d) => d.current_vehicles.length
      ? d.current_vehicles.map((v) => (
        <Link key={v.assignment_id} to={`/vehicles/${v.vehicle_id}`} className="block text-brand hover:underline">{v.plate_number}</Link>
      ))
      : '—' },
    { key: 'is_active', label: 'Status', render: (d) => <Badge tone={d.is_active ? 'green' : 'gray'}>{d.is_active ? 'Active' : 'Inactive'}</Badge> },
  ]

  return (
    <div>
      <PageHeader title="Drivers" actions={can('fleet.add_driver') && (
        <Button onClick={() => setAdding(true)}><Plus size={16} /> Add driver</Button>
      )}>Driver profiles and licenses</PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); set('search', search.trim()) }}>
          <label htmlFor="driver-search" className="sr-only">Search drivers</label>
          <Search size={16} className="absolute top-2.5 left-3 text-slate-400" aria-hidden="true" />
          <input id="driver-search" className={`${inputClass} w-72 pl-9`} placeholder="Name, employee no., license no."
            value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => set('search', search.trim())} />
        </form>
        {(me?.view_all_offices || (me?.offices.length ?? 0) > 1) && (
          <select className={`${inputClass} w-48`} aria-label="Filter by office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
            <option value="">All offices</option>
            {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
          </select>
        )}
        <select className={`${inputClass} w-44`} aria-label="Filter by license status" value={f.license_status ?? ''} onChange={(e) => set('license_status', e.target.value)}>
          <option value="">All licenses</option>
          {LICENSE_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className={`${inputClass} w-40`} aria-label="Filter by status" value={f.is_active ?? ''} onChange={(e) => set('is_active', e.target.value)}>
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      <DataTable columns={columns} query={query} page={page} onPage={(p) => set('page', String(p))}
        empty={f.search || f.office || f.license_status || f.is_active ? 'No drivers match these filters.' : 'No drivers yet.'} />

      <Modal open={adding} onClose={() => setAdding(false)} title="Add driver" wide>
        {adding && <DriverForm driver={{}} onClose={() => setAdding(false)} />}
      </Modal>
    </div>
  )
}
