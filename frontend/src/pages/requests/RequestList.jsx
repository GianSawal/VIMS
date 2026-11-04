import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ClipboardList, Plus } from 'lucide-react'
import { useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { CardGrid, SearchBox, StatCard, Toolbar } from '../../components/filters'
import { Button, formatDateTime, Modal, PageHeader } from '../../components/ui'
import { APPROVE, PROGRESS, ProgressBadge, progressLabel } from './common'
import RequestForm from './RequestForm'

export default function RequestList() {
  const can = useCan()
  const approver = can(APPROVE)
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
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

  const filters = { search: f.search }
  const query = useList('/vehicle-requests/', { page, progress: f.progress, ...filters })
  const summary = useList('/vehicle-requests/summary/', filters)

  const columns = [
    { key: 'ref', label: 'Request', render: (r) => (
      <div>
        <div className="font-mono text-[13px] font-semibold text-brand">{r.reference_number}</div>
        <div className="text-xs text-slate-500">Sent {formatDateTime(r.created_at)}</div>
      </div>
    ) },
    ...(approver ? [{ key: 'requester', label: 'Requested by', render: (r) => (
      <div><div className="font-medium">{r.requester_name}</div><div className="text-xs text-slate-500">{r.office_code}</div></div>
    ) }] : []),
    { key: 'needed', label: 'Needed', render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.needed_at)}</span> },
    { key: 'trip', label: 'Destination and purpose', render: (r) => (
      <div className="max-w-xs">
        <div className="truncate font-medium" title={r.destination}>{r.destination}</div>
        <div className="truncate text-xs text-slate-500" title={r.purpose}>{r.purpose}</div>
      </div>
    ) },
    { key: 'vehicle', label: 'Vehicle', render: (r) => (r.trip
      ? <div><div className="font-semibold tracking-wide">{r.trip.plate_number}</div><div className="text-xs text-slate-500">{r.trip.driver_name ?? 'Driver to be assigned'}</div></div>
      : <span className="text-xs text-slate-400">{r.status === 'PENDING' ? 'Waiting for approval' : '—'}</span>) },
    { key: 'progress', label: 'Status', render: (r) => <ProgressBadge progress={r.progress} /> },
  ]

  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.progress && ['progress', `Status: ${progressLabel(f.progress)}`],
  ].filter(Boolean)
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }
  const clearAll = () => { setSearch(''); setParams({}, { replace: true }) }

  return (
    <div>
      <PageHeader title={approver ? 'Vehicle requests' : 'My vehicle requests'} actions={can('operations.add_vehiclerequest') && (
        <Button onClick={() => setAdding(true)}><Plus size={16} /> Request a vehicle</Button>
      )}>{approver ? 'Approve requests by booking a vehicle, or decline them with a reason.' : 'Ask for a vehicle and follow your request until the trip is done.'}</PageHeader>

      <CardGrid label="Filter by status">
        <StatCard icon={ClipboardList} tint="bg-slate-100 text-slate-700" label="All" count={summary.data?.total}
          loading={summary.isLoading} selected={!f.progress} onClick={() => set('progress', '')} />
        {PROGRESS.map(([key, label, , Icon, tint]) => (
          <StatCard key={key} icon={Icon} tint={tint} label={label} count={summary.data?.[key.toLowerCase()]}
            loading={summary.isLoading} selected={f.progress === key} onClick={() => set('progress', f.progress === key ? '' : key)} />
        ))}
      </CardGrid>

      <DataTable columns={columns} query={query} page={page} onPage={(p) => set('page', String(p))}
        onRowClick={(r) => navigate(`/requests/${r.id}`)}
        toolbar={(
          <Toolbar chips={chips} onRemove={remove} onClear={clearAll}>
            <SearchBox id="request-search" label="Search requests" placeholder="Search reference, destination, purpose…" value={search} onChange={setSearch} />
          </Toolbar>
        )}
        empty={chips.length ? 'No requests match these filters.' : approver ? 'No vehicle requests yet.' : 'You have not requested a vehicle yet.'} />

      <Modal open={adding} onClose={() => setAdding(false)} title="Request a vehicle" wide>
        {adding && <RequestForm onClose={() => setAdding(false)} onSaved={(r) => navigate(`/requests/${r.id}`)} />}
      </Modal>
    </div>
  )
}
