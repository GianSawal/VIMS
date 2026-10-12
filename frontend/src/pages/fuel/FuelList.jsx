import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Banknote, Droplet, FileCheck2, Fuel, Paperclip, Plus, Receipt } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { SearchBox, selectClass, Toolbar } from '../../components/filters'
import { Badge, Button, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatDate, formatKm, formatPeso, FUELS, fuelLabel } from '../vehicles/common'
import FuelForm from './FuelForm'

const liters = (v) => `${Number(v).toLocaleString('en-PH', { maximumFractionDigits: 3 })} L`

/** Estimated km/L cell: always labelled as an estimate; unusual consumption is said in words. */
export function KmPerLiter({ r }) {
  if (!r.km_per_liter) return <span className="text-slate-400" title="Only estimated between two full-tank fill-ups">—</span>
  return (
    <div className="whitespace-nowrap">
      <span className={r.unusual ? 'font-semibold text-danger' : 'font-medium'}>{Number(r.km_per_liter).toFixed(2)}</span>
      <span className="text-xs text-slate-500"> km/L est.</span>
      {r.unusual && <div className="text-xs text-danger">Low vs usual {Number(r.usual_km_per_liter).toFixed(1)}</div>}
    </div>
  )
}

/** Columns shared with the vehicle Fuel tab (`withVehicle` = false there). */
export function fuelColumns({ withVehicle = true } = {}) {
  return [
    { key: 'date', label: 'Date', render: (r) => (
      <Link to={`/fuel/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium whitespace-nowrap text-brand hover:underline">{formatDate(r.date)}</Link>
    ) },
    ...(withVehicle ? [{ key: 'vehicle', label: 'Vehicle', render: (r) => (
      <div><div className="font-medium">{r.plate_number}</div><div className="text-xs text-slate-500">{r.driver_name ?? 'Driver not recorded'}</div></div>
    ) }] : [{ key: 'driver', label: 'Driver', render: (r) => r.driver_name ?? <span className="text-slate-400">—</span> }]),
    { key: 'liters', label: 'Liters', className: 'text-right tabular-nums', render: (r) => (
      <div><div>{liters(r.liters)}</div>{r.is_full_tank && <Badge tone="blue">Full tank</Badge>}</div>
    ) },
    { key: 'price', label: '₱ / L', className: 'text-right tabular-nums', render: (r) => Number(r.unit_price).toFixed(2) },
    { key: 'amount', label: 'Amount', className: 'text-right tabular-nums font-medium', render: (r) => formatPeso(r.total_amount) },
    { key: 'odometer', label: 'Odometer', className: 'text-right tabular-nums', render: (r) => (
      <div><div>{formatKm(r.odometer)}</div>{r.distance_since_last != null && <div className="text-xs text-slate-500">+{r.distance_since_last.toLocaleString('en-PH')} km since last</div>}</div>
    ) },
    { key: 'kml', label: 'Efficiency', render: (r) => <KmPerLiter r={r} /> },
    { key: 'po', label: 'PO / receipt', render: (r) => (
      <div className="text-sm">
        <div className="font-mono text-[13px]">{r.po_number || <span className="font-sans text-slate-400">No PO</span>}</div>
        <div className="text-xs text-slate-500">{r.supplier || r.receipt_number || ''}</div>
      </div>
    ) },
  ]
}

// Spec 5.10 Fuel PO log: same rows, PO-focused columns.
const poColumns = [
  { key: 'date', label: 'Date', render: (r) => <Link to={`/fuel/${r.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-brand hover:underline">{formatDate(r.date)}</Link> },
  { key: 'po', label: 'PO number', render: (r) => <span className="font-mono text-[13px] font-semibold">{r.po_number}</span> },
  { key: 'vehicle', label: 'Vehicle', render: (r) => r.plate_number },
  { key: 'liters', label: 'Fuel liters', className: 'text-right tabular-nums', render: (r) => liters(r.liters) },
  { key: 'odometer', label: 'Odometer', className: 'text-right tabular-nums', render: (r) => formatKm(r.odometer) },
  { key: 'driver', label: 'Driver', render: (r) => r.driver_name ?? <span className="text-slate-400">—</span> },
  { key: 'supplier', label: 'Supplier', render: (r) => r.supplier || <span className="text-slate-400">—</span> },
  { key: 'amount', label: 'Amount', className: 'text-right tabular-nums font-medium', render: (r) => formatPeso(r.total_amount) },
  { key: 'docs', label: 'Supporting document', render: (r) => r.attachment_count
    ? <span className="inline-flex items-center gap-1 text-green-700"><Paperclip size={14} aria-hidden="true" />{r.attachment_count} file{r.attachment_count > 1 ? 's' : ''}</span>
    : <span className="text-amber-700">Missing</span> },
]

export default function FuelList() {
  const can = useCan()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const offices = useAllOffices()
  const [adding, setAdding] = useState(false)
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const f = Object.fromEntries(params)
  const page = Number(f.page ?? 1)
  const poLog = f.view === 'po'

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

  const filters = { search: f.search, office: f.office, fuel_type: f.fuel_type, date_from: f.date_from, date_to: f.date_to, ...(poLog ? { has_po: true } : {}) }
  const query = useList('/fuel-records/', { page, ...filters })
  const summary = useList('/fuel-records/summary/', filters)
  const s = summary.data

  const showOffice = me?.view_all_offices || (me?.offices.length ?? 0) > 1
  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.office && ['office', `Office: ${offices.data?.results.find((o) => String(o.id) === f.office)?.code ?? f.office}`],
    f.fuel_type && ['fuel_type', `Fuel: ${fuelLabel[f.fuel_type]}`],
    f.date_from && ['date_from', `From ${f.date_from}`],
    f.date_to && ['date_to', `To ${f.date_to}`],
  ].filter(Boolean)
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }
  const clearAll = () => { setSearch(''); setParams(poLog ? { view: 'po' } : {}, { replace: true }) }

  const toolbar = (
    <Toolbar chips={chips} onRemove={remove} onClear={clearAll}>
      <SearchBox id="fuel-search" label="Search fuel records" placeholder="Search PO, receipt, supplier, plate, driver…" value={search} onChange={setSearch} />
      {showOffice && (
        <select className={`${selectClass} w-44`} aria-label="Filter by office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
          <option value="">All offices</option>
          {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      )}
      <select className={`${selectClass} w-36`} aria-label="Filter by fuel type" value={f.fuel_type ?? ''} onChange={(e) => set('fuel_type', e.target.value)}>
        <option value="">All fuel types</option>
        {FUELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <label className="flex items-center gap-2 text-sm text-slate-600">From <input type="date" className={`${selectClass} w-40`} value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm text-slate-600">To <input type="date" className={`${selectClass} w-40`} value={f.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></label>
    </Toolbar>
  )

  return (
    <div>
      <PageHeader title="Fuel" actions={can('operations.add_fuelrecord') && (
        <Button onClick={() => setAdding(true)}><Plus size={16} /> Add fuel record</Button>
      )}>Fill-ups, costs, estimated efficiency and the Fuel PO log.</PageHeader>

      <div role="tablist" aria-label="Fuel views" className="mb-4 inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm">
        {[['', 'All fuel records', Fuel], ['po', 'Fuel PO log', FileCheck2]].map(([v, label, Icon]) => (
          <button key={label} role="tab" aria-selected={(f.view ?? '') === v} onClick={() => set('view', v)}
            className={`flex items-center gap-2 rounded-md px-4 py-1.5 font-medium ${(f.view ?? '') === v ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Receipt} tint="bg-slate-100 text-slate-700" label={poLog ? 'PO records' : 'Fill-ups'} value={s ? s.count.toLocaleString('en-PH') : '…'} />
        <Tile icon={Droplet} tint="bg-brand-light text-brand" label="Liters" value={s ? liters(s.liters) : '…'} />
        <Tile icon={Banknote} tint="bg-green-50 text-green-700" label="Total cost" value={s ? formatPeso(s.amount) : '…'} />
        <Tile icon={Fuel} tint="bg-amber-50 text-amber-700" label="Average price / L" value={s ? (s.average_price ? formatPeso(s.average_price) : '—') : '…'} />
      </div>

      <DataTable columns={poLog ? poColumns : fuelColumns()} query={query} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
        onRowClick={(r) => navigate(`/fuel/${r.id}`)}
        empty={chips.length ? 'No fuel records match these filters.' : poLog ? 'No fuel records with a PO number yet.' : 'No fuel records yet.'} />

      <Modal open={adding} onClose={() => setAdding(false)} title="Add fuel record" wide>
        {adding && <FuelForm onClose={() => setAdding(false)} />}
      </Modal>
    </div>
  )
}

function Tile({ icon: Icon, tint, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tint}`}><Icon size={18} aria-hidden="true" /></span>
      <span className="min-w-0">
        <span className="block truncate text-xl leading-none font-semibold tabular-nums">{value}</span>
        <span className="mt-1 block text-xs text-slate-500">{label}</span>
      </span>
    </div>
  )
}
