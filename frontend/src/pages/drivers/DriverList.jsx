import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Clock, IdCard, Plus, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { Avatar, CardGrid, SearchBox, selectClass, StatCard, Toolbar } from '../../components/filters'
import { Badge, Button, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatDate } from '../vehicles/common'
import DriverForm from './DriverForm'
import { expiryNote, LICENSE_STATUSES, LicenseBadge } from './common'

const CARDS = {
  ALL: [IdCard, 'bg-slate-100 text-slate-700', 'All drivers'],
  VALID: [ShieldCheck, 'bg-green-50 text-green-700', 'Valid license'],
  EXPIRING: [Clock, 'bg-amber-50 text-amber-700', 'Expiring soon'],
  EXPIRED: [ShieldAlert, 'bg-red-50 text-danger', 'Expired license'],
}
const card = (type) => ({ icon: CARDS[type][0], tint: CARDS[type][1], label: CARDS[type][2] })

export default function DriverList() {
  const can = useCan()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const offices = useAllOffices()
  const [adding, setAdding] = useState(false)
  // Filters live in the URL so dashboard widgets can link here (e.g. /drivers?license_status=EXPIRING).
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const f = Object.fromEntries(params)
  const page = Number(f.page ?? 1)

  const set = useCallback((key, value) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    return next
  }, { replace: true }), [setParams])

  useEffect(() => {
    const t = setTimeout(() => set('search', search.trim()), 350)
    return () => clearTimeout(t)
  }, [search, set])

  const filters = { search: f.search, office: f.office, is_active: f.is_active }
  const query = useList('/drivers/', { page, license_status: f.license_status, ...filters })
  const summary = useList('/drivers/summary/', filters) // all filters except license_status, so the cards stay comparable

  const showOffice = me?.view_all_offices || (me?.offices.length ?? 0) > 1
  const officeCode = (id) => offices.data?.results.find((o) => String(o.id) === id)?.code ?? id
  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.office && ['office', `Office: ${officeCode(f.office)}`],
    f.license_status && ['license_status', `License: ${LICENSE_STATUSES.find(([v]) => v === f.license_status)?.[1]}`],
    f.is_active && ['is_active', f.is_active === 'true' ? 'Active only' : 'Inactive only'],
  ].filter(Boolean)
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }
  const clearAll = () => { setSearch(''); setParams({}, { replace: true }) }

  const columns = [
    { key: 'driver', label: 'Driver', render: (d) => (
      <div className="flex items-center gap-3">
        <Avatar name={d.full_name} />
        <div className="min-w-0">
          <Link to={`/drivers/${d.id}`} className="font-semibold text-brand hover:underline">{d.full_name}</Link>
          <div className="text-xs text-slate-500">{d.employee_number ? `Emp. no. ${d.employee_number}` : 'No employee number'}</div>
        </div>
      </div>
    ) },
    { key: 'office', label: 'Office', render: (d) => <span title={d.office_name}>{d.office_code}</span> },
    { key: 'license', label: 'License', render: (d) => (
      <div>
        <div className="font-mono text-[13px]">{d.license_number}</div>
        <div className="text-xs text-slate-500">{[d.license_type_display, d.license_restrictions].filter(Boolean).join(' · ')}</div>
      </div>
    ) },
    { key: 'expiry', label: 'Expires', render: (d) => (
      <div className="flex flex-col items-start gap-1">
        <span>{formatDate(d.license_expiry_date)}</span>
        <LicenseBadge status={d.license_status} />
        {d.license_status !== 'VALID' && <span className="text-xs text-slate-500">{expiryNote(d.license_expiry_date)}</span>}
      </div>
    ) },
    { key: 'vehicles', label: 'Current vehicle', render: (d) => d.current_vehicles.length
      ? d.current_vehicles.map((v) => (
        <Link key={v.assignment_id} to={`/vehicles/${v.vehicle_id}`} onClick={(e) => e.stopPropagation()}
          className="block font-medium text-brand hover:underline">{v.plate_number}</Link>
      ))
      : <span className="text-slate-400">Unassigned</span> },
    { key: 'is_active', label: 'Status', render: (d) => <Badge tone={d.is_active ? 'green' : 'gray'} dot>{d.is_active ? 'Active' : 'Inactive'}</Badge> },
  ]

  const toolbar = (
    <Toolbar chips={chips} onRemove={remove} onClear={clearAll}>
      <SearchBox id="driver-search" label="Search drivers" placeholder="Search name, employee no., license no…" value={search} onChange={setSearch} />
      {showOffice && (
        <select className={`${selectClass} w-44`} aria-label="Filter by office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
          <option value="">All offices</option>
          {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      )}
      <select className={`${selectClass} w-36`} aria-label="Filter by status" value={f.is_active ?? ''} onChange={(e) => set('is_active', e.target.value)}>
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
    </Toolbar>
  )

  return (
    <div>
      <PageHeader title="Drivers" actions={can('fleet.add_driver') && (
        <Button onClick={() => setAdding(true)}><Plus size={16} /> Add driver</Button>
      )}>Driver profiles, licenses and assignments.</PageHeader>

      <CardGrid label="Filter by license status">
        <StatCard {...card('ALL')} count={summary.data?.total} loading={summary.isLoading}
          selected={!f.license_status} onClick={() => set('license_status', '')} />
        {LICENSE_STATUSES.map(([value]) => (
          <StatCard key={value} {...card(value)} count={summary.data?.by_license[value] ?? 0} loading={summary.isLoading}
            selected={f.license_status === value} onClick={() => set('license_status', f.license_status === value ? '' : value)} />
        ))}
      </CardGrid>

      <DataTable columns={columns} query={query} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
        onRowClick={(d) => navigate(`/drivers/${d.id}`)}
        empty={chips.length ? 'No drivers match these filters.' : 'No drivers yet.'} />

      <Modal open={adding} onClose={() => setAdding(false)} title="Add driver" wide>
        {adding && <DriverForm driver={{}} onClose={() => setAdding(false)} />}
      </Modal>
    </div>
  )
}
