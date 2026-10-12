import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlarmClockCheck, Ban, CalendarClock, CircleCheck, ClipboardList, ScanSearch, Hammer, Pencil, Plus, TriangleAlert, Wrench,
} from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import DateChip from '../../components/DateChip'
import { CardGrid, SearchBox, selectClass, StatCard, Toolbar } from '../../components/filters'
import { Button, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatDate, formatKm, formatPeso, VehiclePhoto } from '../vehicles/common'
import { CategoryChips, DUE, DueBadge, dueParts, intervalText, MaintenanceStatusBadge, statusLabel, STATUSES, useCategories } from './common'
import MaintenanceForm from './MaintenanceForm'
import ScheduleForm from './ScheduleForm'

const STATUS_CARDS = {
  ALL: [ClipboardList, 'bg-slate-100 text-slate-700', 'All records'],
  SCHEDULED: [CalendarClock, 'bg-slate-100 text-slate-600', 'Scheduled'],
  FOR_INSPECTION: [ScanSearch, 'bg-amber-50 text-amber-700', 'For inspection'],
  IN_PROGRESS: [Hammer, 'bg-brand-light text-brand', 'In progress'],
  COMPLETED: [CircleCheck, 'bg-green-50 text-green-700', 'Completed'],
  CANCELLED: [Ban, 'bg-slate-100 text-slate-500', 'Cancelled'],
}
const DUE_CARDS = {
  ALL: [Wrench, 'bg-slate-100 text-slate-700', 'All schedules'],
  OVERDUE: [TriangleAlert, 'bg-red-50 text-danger', 'Overdue'],
  DUE_SOON: [AlarmClockCheck, 'bg-amber-50 text-amber-700', 'Due soon'],
  OK: [CircleCheck, 'bg-green-50 text-green-700', 'On schedule'],
  NO_BASELINE: [ClipboardList, 'bg-slate-100 text-slate-600', 'No last service'],
}
const card = (map, k) => ({ icon: map[k][0], tint: map[k][1], label: map[k][2] })

/** Maintenance record rows, shared with the vehicle Maintenance tab (`withVehicle` = false there). */
export function recordColumns({ withVehicle = true } = {}) {
  return [
    { key: 'date', label: 'Date', render: (r) => <DateChip value={r.date} to={`/maintenance/${r.id}`} muted={r.status === 'CANCELLED'} /> },
    ...(withVehicle ? [{ key: 'vehicle', label: 'Vehicle', render: (r) => (
      <div className="flex items-center gap-3">
        <VehiclePhoto vehicle={{ photo_url: r.vehicle_photo_url, plate_number: r.plate_number, make: '', model: r.vehicle_label }} className="w-16 shrink-0 border border-slate-200" />
        <div className="min-w-0"><div className="font-semibold tracking-wide">{r.plate_number}</div><div className="truncate text-xs text-slate-500">{r.vehicle_label}</div></div>
      </div>
    ) }] : []),
    { key: 'work', label: 'Work done', render: (r) => (
      <div className="max-w-80 space-y-1">
        <CategoryChips names={r.category_names} />
        <div className="truncate text-sm" title={r.description}>{r.description}</div>
        <div className="truncate text-xs text-slate-500">{[r.service_provider, r.reference_number && `PR ${r.reference_number}`].filter(Boolean).join(' · ') || 'No supplier recorded'}</div>
      </div>
    ) },
    { key: 'odometer', label: 'Odometer', className: 'text-right tabular-nums', render: (r) => (r.odometer != null ? formatKm(r.odometer) : <span className="text-slate-400">—</span>) },
    { key: 'cost', label: 'Cost', className: 'text-right', render: (r) => (
      <div className="tabular-nums">
        <div className="text-base font-semibold">{formatPeso(r.total_cost)}</div>
        <div className="text-xs whitespace-nowrap text-slate-500">Labor {formatPeso(r.labor_cost)} · Parts {formatPeso(r.parts_cost)}</div>
      </div>
    ) },
    { key: 'next', label: 'Next service', render: (r) => (r.next_service_date || r.next_service_odometer != null ? (
      <div className="text-sm whitespace-nowrap">
        {r.next_service_date && <div>{formatDate(r.next_service_date)}</div>}
        {r.next_service_odometer != null && <div className="text-xs text-slate-500">or {formatKm(r.next_service_odometer)}</div>}
      </div>
    ) : <span className="text-slate-400">—</span>) },
    { key: 'status', label: 'Status', render: (r) => <MaintenanceStatusBadge status={r.status} /> },
  ]
}

/** One row per preventive schedule: what, how often, last service, next due, and how close it is. */
export function scheduleColumns({ withVehicle = true, onEdit } = {}) {
  return [
    { key: 'category', label: 'Service', render: (s) => (
      <div>
        <div className="font-semibold">{s.category_name}</div>
        <div className="text-xs text-slate-500">{intervalText(s)}</div>
        {!s.is_active && <div className="text-xs text-slate-400">Inactive</div>}
      </div>
    ) },
    ...(withVehicle ? [{ key: 'vehicle', label: 'Vehicle', render: (s) => (
      <div className="flex items-center gap-3">
        <VehiclePhoto vehicle={{ photo_url: s.vehicle_photo_url, plate_number: s.plate_number, make: '', model: s.vehicle_label }} className="w-16 shrink-0 border border-slate-200" />
        <div className="min-w-0">
          <Link to={`/vehicles/${s.vehicle}?tab=maintenance`} onClick={(e) => e.stopPropagation()} className="font-semibold tracking-wide text-brand hover:underline">{s.plate_number}</Link>
          <div className="truncate text-xs text-slate-500">{s.vehicle_label} · {formatKm(s.vehicle_odometer)}</div>
        </div>
      </div>
    ) }] : []),
    { key: 'last', label: 'Last service', render: (s) => (s.last_service_date || s.last_service_odometer != null ? (
      <div className="text-sm whitespace-nowrap">
        {s.last_service_date && <div>{formatDate(s.last_service_date)}</div>}
        {s.last_service_odometer != null && <div className="text-xs text-slate-500">{formatKm(s.last_service_odometer)}</div>}
      </div>
    ) : <span className="text-slate-400">Not recorded</span>) },
    { key: 'due', label: 'Next due', render: (s) => (s.due.due_date || s.due.due_odometer != null ? (
      <div className="text-sm whitespace-nowrap">
        {s.due.due_date && <div>{formatDate(s.due.due_date)}</div>}
        {s.due.due_odometer != null && <div className="text-xs text-slate-500">{s.due.due_date ? 'or ' : ''}{formatKm(s.due.due_odometer)}</div>}
      </div>
    ) : <span className="text-slate-400">—</span>) },
    { key: 'state', label: 'Status', render: (s) => (
      <div className="space-y-1">
        <DueBadge status={s.due.status} />
        {s.due.status !== 'NO_BASELINE' && (
          <div className="text-xs">
            {dueParts(s.due).map(([text, late]) => <div key={text} className={late ? 'font-medium text-danger' : 'text-slate-500'}>{text}</div>)}
          </div>
        )}
      </div>
    ) },
    ...(onEdit ? [{ key: 'actions', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (s) => (
      <Button variant="ghost" onClick={(e) => { e.stopPropagation(); onEdit(s) }} aria-label={`Edit schedule ${s.category_name} for ${s.plate_number}`} title="Edit"><Pencil size={16} /></Button>
    ) }] : []),
  ]
}

export default function MaintenanceList() {
  const can = useCan()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const offices = useAllOffices()
  const cats = useCategories()
  const [dialog, setDialog] = useState(null) // 'record' | 'schedule' | schedule object
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const f = Object.fromEntries(params)
  const page = Number(f.page ?? 1)
  const schedules = f.view === 'schedules'

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

  const recFilters = { search: f.search, office: f.office, category: f.category, date_from: f.date_from, date_to: f.date_to }
  const records = useList('/maintenance/', { page, status: f.status, ...recFilters })
  const recSummary = useList('/maintenance/summary/', recFilters)
  const schFilters = { search: f.search, office: f.office, category: f.category }
  const schList = useList('/maintenance-schedules/', { page, due: f.due, ...schFilters })
  const schSummary = useList('/maintenance-schedules/summary/', schFilters)

  const showOffice = me?.view_all_offices || (me?.offices.length ?? 0) > 1
  const catName = (id) => cats.data?.find((c) => String(c.id) === id)?.name ?? id
  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.office && ['office', `Office: ${offices.data?.results.find((o) => String(o.id) === f.office)?.code ?? f.office}`],
    f.category && ['category', `Category: ${catName(f.category)}`],
    !schedules && f.status && ['status', `Status: ${statusLabel[f.status]}`],
    schedules && f.due && ['due', `Due: ${DUE[f.due][0]}`],
    !schedules && f.date_from && ['date_from', `From ${f.date_from}`],
    !schedules && f.date_to && ['date_to', `To ${f.date_to}`],
  ].filter(Boolean)
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }
  const clearAll = () => { setSearch(''); setParams(schedules ? { view: 'schedules' } : {}, { replace: true }) }

  const toolbar = (
    <Toolbar chips={chips} onRemove={remove} onClear={clearAll}>
      <SearchBox id="mnt-search" label="Search maintenance" placeholder={schedules ? 'Search plate or service…' : 'Search plate, PR no., supplier, work…'} value={search} onChange={setSearch} />
      {showOffice && (
        <select className={`${selectClass} w-44`} aria-label="Filter by office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
          <option value="">All offices</option>
          {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      )}
      <select className={`${selectClass} w-48`} aria-label="Filter by category" value={f.category ?? ''} onChange={(e) => set('category', e.target.value)}>
        <option value="">All categories</option>
        {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {!schedules && <>
        <label className="flex items-center gap-2 text-sm text-slate-600">From <input type="date" className={`${selectClass} w-40`} value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-600">To <input type="date" className={`${selectClass} w-40`} value={f.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></label>
      </>}
    </Toolbar>
  )

  const attention = schSummary.data ? schSummary.data.by_due.OVERDUE + schSummary.data.by_due.DUE_SOON : 0

  return (
    <div>
      <PageHeader title="Maintenance" actions={(
        <div className="flex gap-2">
          {can('maintenance.add_maintenanceschedule') && <Button variant="secondary" onClick={() => setDialog('schedule')}><CalendarClock size={16} /> Add PM schedule</Button>}
          {can('maintenance.add_maintenancerecord') && <Button onClick={() => setDialog('record')}><Plus size={16} /> Add maintenance</Button>}
        </div>
      )}>Service records, preventive schedules and what is due.</PageHeader>

      <div role="tablist" aria-label="Maintenance views" className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
        {[['', 'Maintenance records', Wrench, 0], ['schedules', 'Preventive schedules', AlarmClockCheck, attention]].map(([v, label, Icon, n]) => (
          <button key={label} role="tab" aria-selected={(f.view ?? '') === v}
            onClick={() => setParams(v ? { view: v } : {}, { replace: true })}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 font-medium ${(f.view ?? '') === v ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon size={16} aria-hidden="true" /> {label}
            {n > 0 && <span className="rounded-full bg-danger px-1.5 text-xs text-white" aria-label={`${n} need attention`}>{n}</span>}
          </button>
        ))}
      </div>

      {schedules ? (
        <>
          <CardGrid label="Filter by due status">
            <StatCard {...card(DUE_CARDS, 'ALL')} count={schSummary.data?.total} loading={schSummary.isLoading} selected={!f.due} onClick={() => set('due', '')} />
            {Object.keys(DUE).map((k) => (
              <StatCard key={k} {...card(DUE_CARDS, k)} count={schSummary.data?.by_due[k] ?? 0} loading={schSummary.isLoading}
                selected={f.due === k} onClick={() => set('due', f.due === k ? '' : k)} />
            ))}
          </CardGrid>
          <DataTable columns={scheduleColumns({ onEdit: can('maintenance.change_maintenanceschedule') ? setDialog : undefined })} query={schList} page={page}
            onPage={(p) => set('page', String(p))} toolbar={toolbar} onRowClick={(s) => navigate(`/vehicles/${s.vehicle}?tab=maintenance`)}
            empty={chips.length ? 'No schedules match these filters.' : 'No preventive schedules yet. Add one to start tracking what is due.'} />
        </>
      ) : (
        <>
          <CardGrid label="Filter by status">
            <StatCard {...card(STATUS_CARDS, 'ALL')} count={recSummary.data?.total} loading={recSummary.isLoading} selected={!f.status} onClick={() => set('status', '')} />
            {STATUSES.map(([k]) => (
              <StatCard key={k} {...card(STATUS_CARDS, k)} count={recSummary.data?.by_status[k] ?? 0} loading={recSummary.isLoading}
                selected={f.status === k} onClick={() => set('status', f.status === k ? '' : k)} />
            ))}
          </CardGrid>
          <p className="mb-3 text-sm text-slate-500">
            Completed work in this view: <strong className="text-ink">{recSummary.data ? formatPeso(recSummary.data.cost) : '…'}</strong>
            {recSummary.data && <span> (labor {formatPeso(recSummary.data.labor)} · parts {formatPeso(recSummary.data.parts)})</span>}
          </p>
          <DataTable columns={recordColumns()} query={records} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
            onRowClick={(r) => navigate(`/maintenance/${r.id}`)} empty={chips.length ? 'No maintenance records match these filters.' : 'No maintenance records yet.'} />
        </>
      )}

      <Modal open={dialog === 'record'} onClose={() => setDialog(null)} title="Add maintenance record" wide>
        {dialog === 'record' && <MaintenanceForm onClose={() => setDialog(null)} onSaved={(r) => navigate(`/maintenance/${r.id}`)} />}
      </Modal>
      <Modal open={dialog === 'schedule' || (!!dialog && typeof dialog === 'object')} onClose={() => setDialog(null)}
        title={typeof dialog === 'object' && dialog ? `Edit schedule: ${dialog.category_name}` : 'Add preventive schedule'} wide>
        {(dialog === 'schedule' || (dialog && typeof dialog === 'object')) && <ScheduleForm schedule={typeof dialog === 'object' ? dialog : undefined} onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}
