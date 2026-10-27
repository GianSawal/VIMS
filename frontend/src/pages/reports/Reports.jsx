import { useEffect } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Car, ChevronRight, FileSpreadsheet, FileText, Fuel, IdCard, Printer, Route, Sheet, ShieldCheck, Wrench,
} from 'lucide-react'
import { api, errorMessage } from '../../api'
import { useMe } from '../../auth'
import { Button, PageHeader } from '../../components/ui'
import { selectClass } from '../../components/filters'
import { useCategories } from '../maintenance/common'

// Report definitions, filters and figures all come from /api/reports/; this page only renders them.
const GROUP_ICONS = { Fleet: Car, Drivers: IdCard, Documents: ShieldCheck, Fuel, Maintenance: Wrench, Trips: Route }
const FILTER_KEYS = ['office', 'vehicle', 'driver', 'status', 'category', 'group_by', 'date_from', 'date_to']
const NUMERIC = new Set(['int', 'km', 'money', 'qty', 'num', 'pct'])

const money = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const whole = new Intl.NumberFormat('en-PH')
const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' })
const dayTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

export function formatCell(value, kind) {
  if (value === null || value === undefined || value === '') return ''
  switch (kind) {
    case 'money': case 'num': return money.format(Number(value))
    case 'qty': return qty.format(Number(value))
    case 'int': case 'km': return whole.format(value)
    case 'pct': return `${Number(value).toFixed(1)}%`
    case 'date': return day.format(new Date(`${value}T00:00:00`))
    case 'datetime': return dayTime.format(new Date(value))
    default: return String(value)
  }
}

export function useReports() {
  return useQuery({ queryKey: ['/reports/'], queryFn: () => api.get('/reports/').then((r) => r.data), staleTime: 5 * 60 * 1000 })
}

/** Current filters from the URL, only the keys reports understand. */
function filterParams(params) {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k)]).filter(([, v]) => v))
}

function useReport(slug, filters, { full = false, enabled = true } = {}) {
  return useQuery({
    queryKey: ['/reports/', slug, filters, full],
    queryFn: () => api.get(`/reports/${slug}/`, { params: { ...filters, ...(full ? { full: 1 } : {}) } }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled,
  })
}

// ---------------------------------------------------------------- catalog

export function ReportCatalog() {
  const reports = useReports()
  const groups = Object.groupBy?.(reports.data ?? [], (r) => r.group)
    ?? (reports.data ?? []).reduce((acc, r) => ({ ...acc, [r.group]: [...(acc[r.group] ?? []), r] }), {})
  return (
    <>
      <PageHeader title="Reports">Preview on screen, print, or download as PDF, Excel or CSV.</PageHeader>
      {reports.isLoading && <p className="text-slate-500">Loading…</p>}
      {reports.isError && <p className="text-danger">{errorMessage(reports.error)}</p>}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {Object.entries(groups).map(([group, items]) => {
          const Icon = GROUP_ICONS[group] ?? FileText
          return (
            <section key={group} aria-labelledby={`grp-${group}`} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <h2 id={`grp-${group}`} className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-ink">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-light text-brand"><Icon size={16} aria-hidden="true" /></span>
                {group}
              </h2>
              <ul className="divide-y divide-slate-100">
                {items.map((r) => (
                  <li key={r.slug}>
                    <Link to={`/reports/${r.slug}`} className="group flex items-center gap-3 px-4 py-3 hover:bg-brand-light/40">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-brand group-hover:underline">{r.title}</span>
                        <span className="block text-xs text-slate-500">{r.description}</span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- one report

function useOptions(path, enabled, params = { page_size: 500 }) {
  return useQuery({
    queryKey: [path, params],
    queryFn: () => api.get(path, { params }).then((r) => r.data.results ?? r.data),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

function Select({ label, value, onChange, options, any = 'All', className = 'w-44' }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      <select className={`${selectClass} ${className}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {any !== null && <option value="">{any}</option>}
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  )
}

function Filters({ meta, filters, applied, set, setMany }) {
  const has = (f) => meta.filters.includes(f)
  const { data: me } = useMe()
  const offices = useOptions('/offices/', has('office'))
  const vehicles = useOptions('/vehicles/', has('vehicle'))
  const drivers = useOptions('/drivers/', has('driver'))
  const categories = useCategories({ includeInactive: true })
  const showOffice = has('office') && (me?.view_all_offices || (me?.offices.length ?? 0) > 1)
  const from = filters.date_from ?? applied?.date_from ?? ''
  const to = filters.date_to ?? applied?.date_to ?? ''
  const month = from && to && from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : ''
  const pickMonth = (m) => {
    if (!m) return setMany({ date_from: '', date_to: '' })
    const [y, mo] = m.split('-').map(Number)
    setMany({ date_from: `${m}-01`, date_to: `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}` })
  }
  return (
    <div className="flex flex-wrap items-end gap-3 p-3">
      {showOffice && <Select label="Office" value={filters.office} onChange={(v) => set('office', v)}
        options={(offices.data ?? []).map((o) => [o.id, `${o.code} - ${o.name}`])} any="All offices" />}
      {has('vehicle') && <Select label={meta.required.includes('vehicle') ? 'Vehicle (required)' : 'Vehicle'} value={filters.vehicle}
        onChange={(v) => set('vehicle', v)} any={meta.required.includes('vehicle') ? 'Choose a vehicle…' : 'All vehicles'}
        options={(vehicles.data ?? []).map((v) => [v.id, `${v.plate_number} · ${v.make} ${v.model}`])} className="w-56" />}
      {has('driver') && <Select label="Driver" value={filters.driver} onChange={(v) => set('driver', v)} any="All drivers"
        options={(drivers.data ?? []).map((d) => [d.id, d.full_name])} className="w-52" />}
      {has('status') && <Select label="Status" value={filters.status} onChange={(v) => set('status', v)} any="Any status"
        options={meta.statuses.map((s) => [s.value, s.label])} />}
      {has('category') && <Select label="Category" value={filters.category} onChange={(v) => set('category', v)} any="All categories"
        options={(categories.data ?? []).map((c) => [c.id, c.name])} />}
      {has('group_by') && <Select label="Group by" value={filters.group_by ?? meta.group_by[0].value} onChange={(v) => set('group_by', v)}
        any={null} options={meta.group_by.map((g) => [g.value, g.label])} className="w-36" />}
      {has('period') && (
        <fieldset className="flex flex-wrap items-end gap-2">
          <legend className="sr-only">{meta.period_label}</legend>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">Month
            <input type="month" className={`${selectClass} w-40`} value={month} onChange={(e) => pickMonth(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">{meta.period_label} from
            <input type="date" className={`${selectClass} w-40`} value={from} onChange={(e) => set('date_from', e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">to
            <input type="date" className={`${selectClass} w-40`} value={to} onChange={(e) => set('date_to', e.target.value)} />
          </label>
        </fieldset>
      )}
    </div>
  )
}

function ReportTable({ data, compact = false }) {
  const pad = compact ? 'px-2 py-1' : 'px-3 py-2'
  const totals = data.totals && Object.values(data.totals).some((v) => v !== null)
  return (
    <table className={`w-full text-left ${compact ? 'text-[11px]' : 'text-sm'}`}>
      <thead className={compact ? 'border-b-2 border-ink' : 'border-b border-slate-200 bg-slate-50 text-[11px] tracking-wider text-slate-500 uppercase'}>
        <tr>
          {data.columns.map((c) => (
            <th key={c.key} scope="col" className={`${pad} font-semibold whitespace-nowrap ${NUMERIC.has(c.kind) ? 'text-right' : ''}`}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {data.rows.length === 0 && (
          <tr><td colSpan={data.columns.length} className="px-3 py-12 text-center text-slate-500">No records match these filters.</td></tr>
        )}
        {data.rows.map((row, i) => (
          <tr key={i} className={compact ? 'break-inside-avoid' : 'hover:bg-brand-light/40'}>
            {data.columns.map((c) => (
              <td key={c.key} className={`${pad} align-top ${NUMERIC.has(c.kind) ? 'text-right tabular-nums whitespace-nowrap' : ''} ${
                c.kind === 'date' || c.kind === 'datetime' ? 'whitespace-nowrap' : ''}`}>
                {formatCell(row[c.key], c.kind)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {totals && data.rows.length > 0 && (
        <tfoot className={`border-t-2 font-semibold ${compact ? 'border-ink' : 'border-slate-300 bg-brand-light/50'}`}>
          <tr>
            {data.columns.map((c, i) => (
              <td key={c.key} className={`${pad} ${NUMERIC.has(c.kind) ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
                {i === 0 ? 'Total' : formatCell(data.totals[c.key], c.kind)}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}

function Summary({ items, compact = false }) {
  if (!items?.length) return null
  return (
    <dl className={`flex flex-wrap ${compact ? 'gap-x-6 gap-y-1 text-xs' : 'mb-4 gap-3'}`}>
      {items.map((s) => compact
        ? <div key={s.label} className="flex gap-1"><dt className="text-slate-600">{s.label}:</dt><dd className="font-semibold">{s.value}</dd></div>
        : (
          <div key={s.label} className="min-w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <dd className="text-lg leading-tight font-semibold text-ink tabular-nums">{typeof s.value === 'number' ? whole.format(s.value) : s.value}</dd>
            <dt className="text-xs text-slate-500">{s.label}</dt>
          </div>
        ))}
    </dl>
  )
}

export function ReportPage() {
  const { slug } = useParams()
  const reports = useReports()
  const meta = reports.data?.find((r) => r.slug === slug)
  const [params, setParams] = useSearchParams()
  const filters = filterParams(params)
  const missing = meta?.required.filter((f) => !filters[f]) ?? []
  const report = useReport(slug, filters, { enabled: !!meta && missing.length === 0 })
  const data = report.data?.slug === slug ? report.data : null

  const setMany = (changes) => setParams((p) => {
    const next = new URLSearchParams(p)
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    return next
  }, { replace: true })
  const set = (k, v) => setMany({ [k]: v })

  if (reports.isLoading) return <p className="text-slate-500">Loading…</p>
  if (!meta) {
    return <p className="text-slate-600">This report does not exist or you do not have access to it. <Link className="text-brand underline" to="/reports">All reports</Link></p>
  }
  const query = new URLSearchParams(filters).toString()
  const exportHref = (fmt) => `/api/reports/${slug}/?${query}${query ? '&' : ''}export=${fmt}`
  const ready = missing.length === 0 && data

  return (
    <>
      <Link to="/reports" className="mb-2 inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ArrowLeft size={14} aria-hidden="true" /> All reports
      </Link>
      <PageHeader title={meta.title} actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!ready} onClick={() => window.open(`/reports/${slug}/print?${query}`, '_blank', 'noopener')}>
            <Printer size={16} aria-hidden="true" /> Print
          </Button>
          {[['pdf', 'PDF', FileText], ['xlsx', 'Excel', FileSpreadsheet], ['csv', 'CSV', Sheet]].map(([fmt, label, Icon]) => ready
            ? (
              <a key={fmt} href={exportHref(fmt)} download
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-slate-50">
                <Icon size={16} aria-hidden="true" /> {label}
              </a>
            )
            : <Button key={fmt} variant="secondary" disabled><Icon size={16} aria-hidden="true" /> {label}</Button>)}
        </div>
      }>{meta.description}</PageHeader>

      {data && <Summary items={data.summary} />}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200">
          <Filters meta={meta} filters={filters} applied={data?.params} set={set} setMany={setMany} />
        </div>
        {missing.length > 0 && <p className="px-4 py-12 text-center text-slate-500">Choose a {missing.join(', ')} to run this report.</p>}
        {missing.length === 0 && report.isError && <p className="px-4 py-12 text-center text-danger">{errorMessage(report.error)}</p>}
        {missing.length === 0 && !data && report.isLoading && <p className="px-4 py-12 text-center text-slate-500">Running report…</p>}
        {ready && (
          <>
            <div className={`overflow-x-auto ${report.isFetching ? 'opacity-60' : ''}`}><ReportTable data={data} /></div>
            <div className="space-y-1 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
              <p>
                <strong className="font-semibold text-ink">{whole.format(data.count)}</strong> {data.count === 1 ? 'row' : 'rows'}
                {data.truncated && <> · showing the first {whole.format(data.rows.length)}; Print and the downloads include every row</>}
              </p>
              {data.notes.map((n) => <p key={n} className="text-xs text-slate-500">{n}</p>)}
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- print view (outside the app layout)

export function ReportPrint() {
  const { slug } = useParams()
  const [params] = useSearchParams()
  const report = useReport(slug, filterParams(params), { full: true })
  const data = report.data

  useEffect(() => {
    if (!data) return
    document.title = `${data.title} - DOLE VRS`
    const t = setTimeout(() => window.print(), 300) // let the logo and fonts paint first
    return () => clearTimeout(t)
  }, [data])

  if (report.isError) return <p className="p-8 text-danger">{errorMessage(report.error)}</p>
  if (!data) return <p className="p-8 text-slate-500">Preparing report…</p>
  const generated = dayTime.format(new Date(data.generated_at))
  return (
    <div className="mx-auto max-w-[297mm] bg-white p-6 text-ink print:max-w-none print:p-0">
      <style>{'@page { size: A4 landscape; margin: 12mm } @media print { body { background: white } }'}</style>
      <div className="mb-4 flex gap-2 print:hidden">
        <Button onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print</Button>
        <Button variant="secondary" onClick={() => window.close()}>Close</Button>
      </div>
      <header className="mb-3 flex items-center gap-3 border-b-2 border-brand pb-3">
        <img src="/dole-logo.png" alt="DOLE logo" className="h-14 w-14" />
        <div>
          <p className="text-[11px]">Republic of the Philippines</p>
          <p className="text-sm font-bold text-brand">Department of Labor and Employment</p>
          <h1 className="text-lg leading-tight font-bold">{data.title}</h1>
        </div>
      </header>
      <div className="mb-3 space-y-1 text-xs">
        {data.filters.map((f) => <p key={f.label}><span className="text-slate-600">{f.label}:</span> {f.value}</p>)}
        <Summary items={data.summary} compact />
      </div>
      <ReportTable data={data} compact />
      <footer className="mt-3 space-y-0.5 text-[10px] text-slate-600">
        {data.notes.map((n) => <p key={n}>{n}</p>)}
        <p>{whole.format(data.count)} rows · Generated {generated} by {data.generated_by} · DOLE Vehicle Records System</p>
      </footer>
    </div>
  )
}
