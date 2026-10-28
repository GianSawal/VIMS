import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Archive, Ban, CalendarClock, CalendarX2, FileCheck2, Paperclip, Plus, TriangleAlert } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { CardGrid, SearchBox, selectClass, StatCard, Toolbar } from '../../components/filters'
import { Button, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatDate, VehiclePhoto } from '../vehicles/common'
import { BANDS, daysText, DocBadge, TYPE_GROUPS } from './common'
import DocumentForm from './DocumentForm'

const BAND_CARDS = [
  ['', FileCheck2, 'bg-slate-100 text-slate-700', 'All current'],
  ['EXPIRED', CalendarX2, 'bg-red-50 text-danger', 'Expired'],
  ['7', TriangleAlert, 'bg-red-50 text-danger', 'Within 7 days'],
  ['15', CalendarClock, 'bg-amber-50 text-amber-700', 'Within 15 days'],
  ['30', CalendarClock, 'bg-amber-50 text-amber-700', 'Within 30 days'],
  ['60', CalendarClock, 'bg-brand-light text-brand', 'Within 60 days'],
]
const VIEWS = [['', 'Current', FileCheck2], ['SUPERSEDED', 'Renewed (history)', Archive], ['CANCELLED', 'Cancelled', Ban]]

/** Document rows, shared with the vehicle Documents tab (`withVehicle` = false there). */
export function documentColumns({ withVehicle = true } = {}) {
  return [
    ...(withVehicle ? [{ key: 'vehicle', label: 'Vehicle', render: (d) => (
      <div className="flex items-center gap-3">
        <VehiclePhoto vehicle={{ photo_url: d.vehicle_photo_url, plate_number: d.plate_number, make: '', model: d.vehicle_label }} className="w-16 shrink-0 border border-slate-200" />
        <div className="min-w-0">
          <Link to={`/documents/${d.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold tracking-wide text-brand hover:underline">{d.plate_number}</Link>
          <div className="truncate text-xs text-slate-500">{d.vehicle_label} · {d.office_code}</div>
        </div>
      </div>
    ) }] : []),
    { key: 'doc', label: 'Document', render: (d) => (
      <div className="min-w-0">
        {withVehicle ? <div className="font-medium">{d.document_type_display}</div>
          : <Link to={`/documents/${d.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand hover:underline">{d.document_type_display}</Link>}
        <div className="text-xs text-slate-500">{d.reference_number || 'No reference number'}</div>
      </div>
    ) },
    { key: 'issued', label: 'Issued', render: (d) => <span className="whitespace-nowrap">{formatDate(d.issue_date)}</span> },
    { key: 'expires', label: 'Expires', render: (d) => (
      <div className="whitespace-nowrap">
        <div>{d.expiry_date ? formatDate(d.expiry_date) : <span className="text-slate-400">No expiry</span>}</div>
        {daysText(d.expiry) && <div className={`text-xs ${d.expiry.band === 'EXPIRED' || d.expiry.band === '7' ? 'font-medium text-danger' : 'text-slate-500'}`}>{daysText(d.expiry)}</div>}
      </div>
    ) },
    { key: 'status', label: 'Status', render: (d) => <DocBadge doc={d} /> },
    { key: 'file', label: <span className="sr-only">Scanned copy</span>, className: 'text-right', render: (d) => (d.file ? (
      <a href={d.file} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open scanned copy"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand hover:bg-brand-light">
        <Paperclip size={14} aria-hidden="true" /> Scan
      </a>
    ) : <span className="text-xs text-slate-400">No scan</span>) },
  ]
}

export default function DocumentList() {
  const can = useCan()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const offices = useAllOffices()
  const [adding, setAdding] = useState(false)
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const f = Object.fromEntries(params)
  const page = Number(f.page ?? 1)
  const status = f.status ?? ''

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

  const filters = { search: f.search, office: f.office, document_type: f.type }
  const list = useList('/documents/', { page, ...filters, status: status || 'ACTIVE', band: status ? undefined : f.band })
  const summary = useList('/documents/summary/', filters)

  const showOffice = me?.view_all_offices || (me?.offices.length ?? 0) > 1
  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.office && ['office', `Office: ${offices.data?.results.find((o) => String(o.id) === f.office)?.code ?? f.office}`],
    f.type && ['type', TYPE_GROUPS.find(([k]) => k === f.type)?.[1] ?? f.type],
    !status && f.band && ['band', BANDS[f.band]?.[0] ?? f.band],
  ].filter(Boolean)
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }
  const clearAll = () => { setSearch(''); setParams(status ? { status } : {}, { replace: true }) }
  const urgent = summary.data ? summary.data.by_band.EXPIRED + summary.data.by_band['7'] : 0

  const toolbar = (
    <Toolbar chips={chips} onRemove={remove} onClear={clearAll}>
      <SearchBox id="doc-search" label="Search documents" placeholder="Search plate, reference no., remarks…" value={search} onChange={setSearch} />
      <select className={`${selectClass} w-48`} aria-label="Filter by document type" value={f.type ?? ''} onChange={(e) => set('type', e.target.value)}>
        {TYPE_GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {showOffice && (
        <select className={`${selectClass} w-44`} aria-label="Filter by office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
          <option value="">All offices</option>
          {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      )}
      {!status && (
        <select className={`${selectClass} w-40`} aria-label="Filter by expiry" value={f.band ?? ''} onChange={(e) => set('band', e.target.value)}>
          <option value="">Any expiry</option>
          {Object.entries(BANDS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
    </Toolbar>
  )

  return (
    <div>
      <PageHeader title="Documents & Renewals" actions={can('fleet.add_vehicledocument') && (
        <Button onClick={() => setAdding(true)}><Plus size={16} /> Add document</Button>
      )}>LTO registration, OR/CR and GSIS/insurance, with alerts 60, 30, 15 and 7 days before they expire.</PageHeader>

      <div role="tablist" aria-label="Document views" className="mb-4 inline-flex max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
        {VIEWS.map(([v, label, Icon]) => (
          <button key={label} role="tab" aria-selected={status === v}
            onClick={() => setParams(v ? { status: v } : {}, { replace: true })}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-1.5 font-medium ${status === v ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon size={16} aria-hidden="true" /> {label}
            {!v && urgent > 0 && <span className="rounded-full bg-danger px-1.5 text-xs text-white" aria-label={`${urgent} expired or expiring within 7 days`}>{urgent}</span>}
          </button>
        ))}
      </div>

      {!status && (
        <CardGrid label="Filter by expiry">
          {BAND_CARDS.map(([k, icon, tint, label]) => (
            <StatCard key={label} icon={icon} tint={tint} label={label} loading={summary.isLoading}
              count={k ? summary.data?.by_band[k] : summary.data?.total}
              selected={(f.band ?? '') === k} onClick={() => set('band', f.band === k ? '' : k)} />
          ))}
        </CardGrid>
      )}

      <DataTable columns={documentColumns()} query={list} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
        onRowClick={(d) => navigate(`/documents/${d.id}`)}
        empty={chips.length ? 'No documents match these filters.' : status ? 'Nothing here yet.' : 'No documents yet. Add the LTO registration, OR/CR and insurance of each vehicle to start tracking renewals.'} />

      <Modal open={adding} onClose={() => setAdding(false)} title="Add document" wide>
        {adding && <DocumentForm onClose={() => setAdding(false)} onSaved={(d) => navigate(`/documents/${d.id}`)} />}
      </Modal>
    </div>
  )
}
