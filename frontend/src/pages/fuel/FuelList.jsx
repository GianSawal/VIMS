import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Banknote, Droplet, FileCheck2, Fuel, Minus, Paperclip, Plus, Receipt, TrendingDown, TrendingUp } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import { RankBars, TimeBars } from '../../components/charts'
import DataTable from '../../components/DataTable'
import { SearchBox, selectClass, Toolbar } from '../../components/filters'
import { Button, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatDate, formatKm, formatPeso, FUELS, fuelLabel, VehiclePhoto } from '../vehicles/common'
import FuelForm from './FuelForm'

const liters = (v) => `${Number(v).toLocaleString('en-PH', { maximumFractionDigits: 3 })} L`

/** Estimated km/L cell: always labelled as an estimate; when there is none, say why instead of a bare dash. */
export function KmPerLiter({ r }) {
  if (!r.km_per_liter) {
    const why = !r.is_full_tank ? 'Partial fill' : 'First full tank'
    const tip = !r.is_full_tank ? 'Partial fills are not estimated' : 'Baseline: the next full tank gives an estimate'
    return <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500" title={tip}>{why}</span>
  }
  return (
    <div className="whitespace-nowrap">
      <span className={`inline-flex items-baseline gap-1 rounded-full px-2.5 py-0.5 ${r.unusual ? 'bg-red-50 text-danger ring-1 ring-red-200' : 'bg-brand-light text-brand'}`}>
        <span className="text-sm font-semibold tabular-nums">{Number(r.km_per_liter).toFixed(2)}</span>
        <span className="text-[11px]">km/L est.</span>
      </span>
      {r.unusual && <div className="mt-1 text-xs text-danger">Low vs usual {Number(r.usual_km_per_liter).toFixed(1)}</div>}
    </div>
  )
}

// Identity tint per fuel type (always shown with its name, never color alone).
const FUEL_CHIP = {
  DIESEL: 'bg-amber-50 text-amber-800 ring-amber-200',
  GASOLINE: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  HYBRID: 'bg-sky-50 text-sky-800 ring-sky-200',
  ELECTRIC: 'bg-sky-50 text-sky-800 ring-sky-200',
  OTHER: 'bg-slate-100 text-slate-700 ring-slate-200',
}

const dayNum = new Intl.DateTimeFormat('en-PH', { day: 'numeric' })
const monShort = new Intl.DateTimeFormat('en-PH', { month: 'short' })
const yearNum = new Intl.DateTimeFormat('en-PH', { year: 'numeric' })

function DateChip({ r }) {
  const d = new Date(`${r.date}T00:00:00`)
  return (
    <Link to={`/fuel/${r.id}`} onClick={(e) => e.stopPropagation()} aria-label={`Open fuel record of ${formatDate(r.date)}`}
      className="flex w-14 flex-col items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-center shadow-sm hover:border-brand">
      <span className="w-full bg-brand py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase">{monShort.format(d)}</span>
      <span className="text-lg leading-tight font-bold text-ink tabular-nums">{dayNum.format(d)}</span>
      <span className="pb-0.5 text-[10px] text-slate-500">{yearNum.format(d)}</span>
    </Link>
  )
}

/** Columns shared with the vehicle Fuel tab (`withVehicle` = false there). */
export function fuelColumns({ withVehicle = true } = {}) {
  return [
    { key: 'date', label: 'Date', render: (r) => <DateChip r={r} /> },
    ...(withVehicle ? [{ key: 'vehicle', label: 'Vehicle', render: (r) => (
      <div className="flex items-center gap-3">
        <VehiclePhoto vehicle={{ photo_url: r.vehicle_photo_url, plate_number: r.plate_number, make: '', model: r.vehicle_label }} className="w-16 shrink-0 border border-slate-200" />
        <div className="min-w-0">
          <div className="font-semibold tracking-wide">{r.plate_number}</div>
          <div className="truncate text-xs text-slate-500">{r.vehicle_label}</div>
          <div className="truncate text-xs text-slate-500">{r.driver_name ? `Driver: ${r.driver_name}` : 'Driver not recorded'}</div>
        </div>
      </div>
    ) }] : [{ key: 'driver', label: 'Driver', render: (r) => r.driver_name ?? <span className="text-slate-400">Not recorded</span> }]),
    { key: 'fuel', label: 'Fuel', render: (r) => (
      <div className="space-y-1">
        <div className="text-base font-semibold tabular-nums">{liters(r.liters)}</div>
        <div className="flex flex-wrap gap-1">
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${FUEL_CHIP[r.fuel_type] ?? FUEL_CHIP.OTHER}`}>{r.fuel_type_display}</span>
          {r.is_full_tank && <span className="rounded-md bg-brand-light px-1.5 py-0.5 text-[11px] font-medium text-brand ring-1 ring-brand/20">Full tank</span>}
        </div>
      </div>
    ) },
    { key: 'cost', label: 'Cost', className: 'text-right', render: (r) => (
      <div className="tabular-nums">
        <div className="text-base font-semibold text-ink">{formatPeso(r.total_amount)}</div>
        <div className="text-xs whitespace-nowrap text-slate-500">{Number(r.liters).toLocaleString('en-PH', { maximumFractionDigits: 3 })} L × ₱{Number(r.unit_price).toFixed(2)}</div>
      </div>
    ) },
    { key: 'odometer', label: 'Odometer', className: 'text-right', render: (r) => (
      <div className="tabular-nums">
        <div className="font-medium">{formatKm(r.odometer)}</div>
        <div className="text-xs whitespace-nowrap text-slate-500">{r.distance_since_last != null ? `+${r.distance_since_last.toLocaleString('en-PH')} km since last` : 'First on record'}</div>
      </div>
    ) },
    { key: 'kml', label: 'Efficiency', render: (r) => <KmPerLiter r={r} /> },
    { key: 'po', label: 'PO / receipt', render: (r) => (
      <div className="space-y-1">
        {r.po_number
          ? <span className="inline-block rounded-md border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-ink">{r.po_number}</span>
          : <span className="inline-block rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-400">No PO</span>}
        <div className="flex items-center gap-1 text-xs text-slate-500">
          {r.attachment_count > 0 && <Paperclip size={12} className="text-green-700" aria-label={`${r.attachment_count} attachment(s)`} />}
          <span className="truncate">{r.supplier || r.receipt_number || ''}</span>
        </div>
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
  const insights = useList('/fuel-records/insights/', filters)
  const s = summary.data
  const months = insights.data?.months ?? []
  const trend = months.map((m) => {
    const d = new Date(`${m.month}-01T00:00:00`)
    return {
      key: m.month, value: Number(m.amount), short: monthShort.format(d), label: monthLong.format(d),
      tooltip: [`Cost: ${formatPeso(m.amount)}`, `Fuel: ${liters(m.liters)}`],
    }
  })
  // Month-over-month change only makes sense on the default "last 12 months" view.
  const delta = !f.date_from && !f.date_to && trend.length >= 2 ? change(trend.at(-1).value, trend.at(-2).value) : null

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

      <div role="tablist" aria-label="Fuel views" className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
        {[['', 'All fuel records', Fuel], ['po', 'Fuel PO log', FileCheck2]].map(([v, label, Icon]) => (
          <button key={label} role="tab" aria-selected={(f.view ?? '') === v} onClick={() => set('view', v)}
            className={`flex items-center gap-2 rounded-md px-4 py-1.5 font-medium ${(f.view ?? '') === v ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Banknote} tint="bg-green-50 text-green-700" label="Total fuel cost" value={s ? formatPeso(s.amount) : null}
          sub={delta && <Delta d={delta} prevLabel={trend.at(-2).short} />} />
        <Kpi icon={Droplet} tint="bg-brand-light text-brand" label="Liters purchased" value={s ? liters(s.liters) : null}
          sub={s && s.count ? `${s.count.toLocaleString('en-PH')} ${poLog ? 'PO records' : 'fill-ups'}` : null} />
        <Kpi icon={Fuel} tint="bg-amber-50 text-amber-700" label="Average price per liter" value={s ? (s.average_price ? formatPeso(s.average_price) : '—') : null}
          sub="Weighted by liters" />
        <Kpi icon={Receipt} tint="bg-slate-100 text-slate-700" label={poLog ? 'With PO number' : 'Full-tank fill-ups'}
          value={s ? (poLog ? s.with_po_count : s.full_tank_count).toLocaleString('en-PH') : null}
          sub={poLog ? 'Same records as the fuel list' : 'Used for km/L estimates'} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2" aria-labelledby="trend-title">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h2 id="trend-title" className="font-semibold text-ink">Monthly fuel cost</h2>
            {trend.length > 0 && <span className="text-xs text-slate-500">{trend[0].label} – {trend.at(-1).label}</span>}
          </div>
          <p className="mb-3 text-xs text-slate-500">Hover or tab to a month for cost and liters.</p>
          {insights.isLoading ? <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
            : trend.some((m) => m.value > 0) ? <TimeBars data={trend} format={formatPeso} valueLabel="Fuel cost" />
            : <EmptyChart text="No fuel purchases in this period." />}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="top-title">
          <h2 id="top-title" className="font-semibold text-ink">Top vehicles by fuel cost</h2>
          <p className="mb-4 text-xs text-slate-500">Same filters and period as the chart.</p>
          {insights.isLoading ? <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
            : insights.data?.top_vehicles.length ? (
              <RankBars items={insights.data.top_vehicles.map((t) => ({
                key: t.vehicle, to: `/vehicles/${t.vehicle}`, title: t.plate_number, subtitle: t.label,
                value: Number(t.amount), valueText: formatPeso(t.amount),
                detail: `${liters(t.liters)} · ${t.fills} fill${t.fills === 1 ? '' : 's'}`,
              }))} />
            ) : <EmptyChart text="No vehicles to rank yet." />}
        </section>
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

const monthShort = new Intl.DateTimeFormat('en-PH', { month: 'short' })
const monthLong = new Intl.DateTimeFormat('en-PH', { month: 'short', year: 'numeric' })

function change(cur, prev) {
  if (!prev) return cur ? { dir: 'up', pct: null } : null
  const pct = Math.round(((cur - prev) / prev) * 100)
  return { dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', pct: Math.abs(pct) }
}

// Neutral ink: more fuel spend isn't automatically bad, so no red/green judgement here.
function Delta({ d, prevLabel }) {
  const Icon = { up: TrendingUp, down: TrendingDown, flat: Minus }[d.dir]
  const text = d.pct == null ? `New this month (none in ${prevLabel})` : d.dir === 'flat' ? `Same as ${prevLabel}` : `${d.pct}% ${d.dir === 'up' ? 'more' : 'less'} than ${prevLabel}`
  return <span className="inline-flex items-center gap-1"><Icon size={13} aria-hidden="true" /> This month: {text}</span>
}

function Kpi({ icon: Icon, tint, label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${tint}`}><Icon size={15} aria-hidden="true" /></span>
        {label}
      </div>
      {value == null
        ? <div className="mt-3 h-7 w-28 animate-pulse rounded bg-slate-200" />
        : <div className="mt-2 truncate text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</div>}
      <div className="mt-1 min-h-4 text-xs text-slate-500">{sub}</div>
    </div>
  )
}

function EmptyChart({ text }) {
  return <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500">{text}</div>
}
