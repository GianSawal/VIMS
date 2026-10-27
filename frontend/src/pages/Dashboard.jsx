import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Ban, Car, CircleCheck, FileText, Fuel, IdCard, Navigation, PackageX, Route as RouteIcon, ShieldCheck,
  TriangleAlert, Wrench,
} from 'lucide-react'
import { useList } from '../api'
import { useMe } from '../auth'
import { RankBars, TimeBars } from '../components/charts'
import { selectClass } from '../components/filters'
import { PageHeader } from '../components/ui'
import { useAllOffices } from './admin/Offices'
import { formatDate, formatKm, formatPeso } from './vehicles/common'

/*
 * Phase 12. One request (/api/dashboard/) returns only the sections the user may view, already office-scoped.
 * Every count links to the list it was computed from, with the same filters (office, month, status/band).
 */

// Vehicle statuses in fleet-bar order: bar color (--color-st-*, validated), icon and label. Color never stands alone.
const STATUSES = [
  ['SERVICEABLE', 'Serviceable', CircleCheck, 'bg-st-good', 'var(--color-st-good)'],
  ['IN_USE', 'In use', Navigation, 'bg-chart', 'var(--color-chart)'],
  ['UNDER_MAINTENANCE', 'Under maintenance', Wrench, 'bg-st-warn', 'var(--color-st-warn)'],
  ['FOR_REPAIR', 'For repair', TriangleAlert, 'bg-st-serious', 'var(--color-st-serious)'],
  ['UNSERVICEABLE', 'Unserviceable', Ban, 'bg-st-critical', 'var(--color-st-critical)'],
  ['DISPOSED', 'Disposed', PackageX, 'bg-slate-400', 'var(--color-slate-400)'],
]

const monthShort = new Intl.DateTimeFormat('en-PH', { month: 'short' })
const monthLong = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' })
const dayLong = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })
const timeShort = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
const num = new Intl.NumberFormat('en-PH')
const liters = (v) => `${num.format(Number(v))} L`
const ymDate = (ym) => new Date(`${ym}-01T00:00:00`)
const plural = (n, word) => `${num.format(n)} ${word}${n === 1 ? '' : 's'}`

// '2026-10' -> ['2026-10-01', '2026-10-31'], the date_from/date_to the list pages understand.
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  return [`${ym}-01`, `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`]
}

// Build a list link carrying the dashboard's office filter.
const href = (path, params, office) => {
  const q = new URLSearchParams(Object.entries({ ...params, office }).filter(([, v]) => v))
  return q.size ? `${path}?${q}` : path
}

export default function Dashboard() {
  const { data: me } = useMe()
  const offices = useAllOffices()
  const [params, setParams] = useSearchParams()
  const office = params.get('office') ?? ''
  const month = params.get('month') ?? ''
  const set = (key, value) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (value) next.set(key, value)
    else next.delete(key)
    return next
  }, { replace: true })

  const query = useList('/dashboard/', { office: office || undefined, month: month || undefined })
  const d = query.data
  const showOffice = me?.view_all_offices || (me?.offices.length ?? 0) > 1
  const selectedMonth = d?.month ?? month
  const [from, to] = selectedMonth ? monthRange(selectedMonth) : []
  const monthName = selectedMonth ? monthLong.format(ymDate(selectedMonth)) : 'This month'
  const attention = d && [d.renewals, d.maintenance_due, d.licenses].some(Boolean)

  return (
    <div>
      <PageHeader title="Dashboard" actions={
        <div className="flex flex-wrap items-center gap-2">
          {showOffice && (
            <select className={`${selectClass} w-52`} aria-label="Office" value={office} onChange={(e) => set('office', e.target.value)}>
              <option value="">All my offices</option>
              {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Month <input type="month" className={`${selectClass} w-40`} value={selectedMonth} max={d?.today?.slice(0, 7)}
              onChange={(e) => set('month', e.target.value)} />
          </label>
        </div>
      }>{d?.today ? dayLong.format(new Date(`${d.today}T00:00:00`)) : 'Fleet overview'}</PageHeader>

      {query.isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-danger">The dashboard could not be loaded. Please refresh the page.</p>
      ) : query.isLoading ? (
        <div className="space-y-4"><Skeleton className="h-36" /><Skeleton className="h-56" /><Skeleton className="h-72" /></div>
      ) : (
        <div className="space-y-6">
          {d.vehicles && <FleetStatus v={d.vehicles} office={office} />}

          {attention && (
            <Section title="Needs attention">
              <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
                {d.renewals && <ExpiryWidget icon={Car} title="LTO registration" data={d.renewals.lto} window={d.renewals.window_days}
                  all={href('/documents', { type: 'LTO_REGISTRATION' }, office)}
                  expiredTo={href('/documents', { type: 'LTO_REGISTRATION', band: 'EXPIRED' }, office)} />}
                {d.renewals && <ExpiryWidget icon={ShieldCheck} title="GSIS / insurance" data={d.renewals.insurance} window={d.renewals.window_days}
                  all={href('/documents', { type: 'GSIS_INSURANCE,INSURANCE_POLICY' }, office)}
                  expiredTo={href('/documents', { type: 'GSIS_INSURANCE,INSURANCE_POLICY', band: 'EXPIRED' }, office)} />}
                {d.maintenance_due && <MaintenanceDue data={d.maintenance_due} office={office} />}
                {d.licenses && <Licenses data={d.licenses} office={office} />}
              </div>
            </Section>
          )}

          {(d.fuel || d.maintenance_cost || d.utilization) && (
            <Section title={monthName}>
              <div className="grid items-start gap-4 lg:grid-cols-2">
                {d.fuel && (
                  <MoneyTrend title="Fuel" icon={Fuel} data={d.fuel} to={href('/fuel', { date_from: from, date_to: to }, office)}
                    stats={[[liters(d.fuel.liters), 'Purchased'], [num.format(d.fuel.count), 'Fill-ups']]}
                    tooltip={(m) => [`Cost: ${formatPeso(m.amount)}`, `Fuel: ${liters(m.liters)}`]} />
                )}
                {d.maintenance_cost && (
                  <MoneyTrend title="Maintenance cost" icon={Wrench} data={d.maintenance_cost}
                    to={href('/maintenance', { status: 'COMPLETED', date_from: from, date_to: to }, office)}
                    stats={[[num.format(d.maintenance_cost.count), 'Completed'], [num.format(d.maintenance_cost.open), 'Open jobs', href('/maintenance', {}, office)]]}
                    tooltip={(m) => [`Cost: ${formatPeso(m.amount)}`, `${plural(m.count, 'job')} completed`]} />
                )}
                {d.utilization && <Utilization u={d.utilization} office={office} from={from} to={to} />}
                {d.vehicles && d.vehicles.by_office.length > 0 && <ByOffice rows={d.vehicles.by_office} office={office} />}
              </div>
            </Section>
          )}

          <Activity items={d.activity} />
        </div>
      )}
    </div>
  )
}

function Skeleton({ className }) {
  return <div className={`animate-pulse rounded-xl bg-slate-100 ${className}`} />
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Card({ title, icon: Icon, tint = 'bg-brand-light text-brand', action, children }) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2.5">
        {Icon && <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tint}`}><Icon size={16} aria-hidden="true" /></span>}
        <h3 className="mr-auto font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

const ViewAll = ({ to, children = 'View all' }) => <Link to={to} className="text-xs font-medium whitespace-nowrap text-brand hover:underline">{children}</Link>

// Part-to-whole bar: one segment per non-zero status, 2px surface gap, rounded ends, hover title; legend carries identity.
function StatusBar({ byStatus, total, height = 'h-3', office, officeId }) {
  return (
    <div className={`flex w-full gap-[2px] overflow-hidden rounded-full ${total ? '' : 'bg-slate-100'} ${height}`}>
      {total > 0 && STATUSES.filter(([s]) => byStatus[s]).map(([s, label, , color]) => (
        <Link key={s} to={href('/vehicles', { status: s }, officeId ?? office)} style={{ width: `${(byStatus[s] / total) * 100}%` }}
          title={`${label}: ${byStatus[s]} of ${total}`} aria-label={`${label}: ${byStatus[s]} of ${total}`}
          className={`${color} h-full transition-opacity first:rounded-l-full last:rounded-r-full hover:opacity-80`} />
      ))}
    </div>
  )
}

// Donut of the fleet by status: one arc per non-zero status with a small gap between arcs, total in the middle.
// Arcs navigate on click (mouse); the legend beside it carries the same links for keyboard users.
function StatusDonut({ byStatus, total, office }) {
  const navigate = useNavigate()
  const r = 42
  const c = 2 * Math.PI * r
  const parts = STATUSES.filter(([s]) => byStatus[s])
  const gap = parts.length > 1 ? 1.5 : 0
  let offset = 0
  return (
    <div className="relative h-44 w-44 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img"
        aria-label={`Fleet by status: ${parts.map(([s, label]) => `${label} ${byStatus[s]}`).join(', ') || 'no vehicles'}`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-slate-100)" strokeWidth="12" />
        {total > 0 && parts.map(([s, label, , , stroke]) => {
          const len = (byStatus[s] / total) * c
          const arc = (
            <circle key={s} cx="50" cy="50" r={r} fill="none" stroke={stroke} strokeWidth="12"
              strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`} strokeDashoffset={-offset}
              className="cursor-pointer transition-opacity hover:opacity-80"
              onClick={() => navigate(href('/vehicles', { status: s }, office))}>
              <title>{`${label}: ${byStatus[s]} of ${total} (${Math.round((byStatus[s] / total) * 100)}%)`}</title>
            </circle>
          )
          offset += len
          return arc
        })}
      </svg>
      <Link to={href('/vehicles', {}, office)} className="absolute inset-0 m-auto flex h-24 w-24 flex-col items-center justify-center rounded-full hover:text-brand">
        <span className="text-3xl leading-none font-semibold text-ink tabular-nums">{num.format(total)}</span>
        <span className="mt-1 text-xs text-slate-500">{total === 1 ? 'vehicle' : 'vehicles'}</span>
      </Link>
    </div>
  )
}

function FleetStatus({ v, office }) {
  const s = v.by_status
  const operable = v.total - s.DISPOSED
  const available = operable ? Math.round(((s.SERVICEABLE + s.IN_USE) / operable) * 100) : null
  const share = (n) => (v.total ? `${Math.round((n / v.total) * 100)}%` : '–')
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="fleet-title">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 id="fleet-title" className="font-semibold text-ink">Fleet status</h2>
        <Link to={href('/vehicles', {}, office)} className="text-xs font-medium text-brand hover:underline">View vehicles</Link>
      </div>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <StatusDonut byStatus={s} total={v.total} office={office} />
        <div className="w-full min-w-0 flex-1">
          {available != null && (
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b border-slate-100 pb-3">
              <span className="text-2xl font-semibold text-ink tabular-nums">{available}%</span>
              <span className="text-sm text-slate-600">available for use</span>
              <span className="text-xs text-slate-500">Serviceable or in use, out of all vehicles not disposed.</span>
            </div>
          )}
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {STATUSES.map(([status, label, Icon, color]) => (
              <li key={status}>
                <Link to={href('/vehicles', { status }, office)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />
                  <Icon size={15} className="shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{label}</span>
                  <span className={`text-sm font-semibold tabular-nums ${s[status] ? 'text-ink' : 'text-slate-400'}`}>{num.format(s[status])}</span>
                  <span className="w-10 text-right text-xs text-slate-500 tabular-nums">{share(s[status])}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

// Urgent (danger) and upcoming (amber) counts linking to the filtered list; a single "All clear" when both are zero.
function Counts({ urgent, upcoming }) {
  if (!urgent[0] && !upcoming[0]) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2.5 text-sm font-medium text-green-800">
        <CircleCheck size={16} aria-hidden="true" /> All clear
      </p>
    )
  }
  const tile = (n, label, to, on) => (
    <Link key={label} to={to} className={`rounded-lg px-3 py-2 transition ${n ? on : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
      <span className="block text-xl leading-none font-semibold tabular-nums">{num.format(n)}</span>
      <span className="mt-1 block text-xs">{label}</span>
    </Link>
  )
  return (
    <div className="grid grid-cols-2 gap-2">
      {tile(...urgent, 'bg-red-50 text-danger hover:bg-red-100')}
      {tile(...upcoming, 'bg-amber-50 text-amber-800 hover:bg-amber-100')}
    </div>
  )
}

// Header icon tint follows the worst state in the widget.
const severity = (urgent, upcoming) => (urgent ? 'bg-red-50 text-danger' : upcoming ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700')

function Rows({ items }) {
  if (!items.length) return null
  return (
    <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-sm">
      {items.map((i) => (
        <li key={i.key}>
          <Link to={i.to} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 hover:bg-slate-50">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{i.title}</span>
              <span className="block truncate text-xs text-slate-500">{i.sub}</span>
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${i.urgent ? 'bg-red-50 text-danger' : 'bg-amber-50 text-amber-800'}`}>{i.when}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const daysWord = (n) => (n < 0 ? `${-n}d ago` : n === 0 ? 'today' : `in ${n}d`)

function ExpiryWidget({ icon, title, data, window, all, expiredTo }) {
  return (
    <Card title={title} icon={icon} tint={severity(data.expired, data.due)} action={<ViewAll to={all} />}>
      <Counts urgent={[data.expired, 'Expired', expiredTo]} upcoming={[data.due, `Within ${window} days`, all]} />
      <Rows items={data.items.map((x) => ({
        key: x.id, to: `/documents/${x.id}`, title: x.plate_number, sub: `${x.document_type_display} · ${formatDate(x.expiry_date)}`,
        when: x.band === 'EXPIRED' ? `Expired ${daysWord(x.days_left)}` : `Expires ${daysWord(x.days_left)}`, urgent: x.band === 'EXPIRED' || x.band === '7',
      }))} />
    </Card>
  )
}

function MaintenanceDue({ data, office }) {
  const to = (due) => href('/maintenance', { view: 'schedules', due }, office)
  const when = (x) => {
    const parts = []
    if (x.days_left != null) parts.push(x.days_left < 0 ? `${-x.days_left}d over` : `${x.days_left}d`)
    if (x.km_left != null) parts.push(x.km_left < 0 ? `${num.format(-x.km_left)} km over` : `${num.format(x.km_left)} km`)
    return parts.join(' / ')
  }
  return (
    <Card title="Maintenance due" icon={Wrench} tint={severity(data.overdue, data.due_soon)} action={<ViewAll to={to('')} />}>
      <Counts urgent={[data.overdue, 'Overdue', to('OVERDUE')]} upcoming={[data.due_soon, 'Due soon', to('DUE_SOON')]} />
      <Rows items={data.items.map((x) => ({
        key: x.id, to: `/vehicles/${x.vehicle}?tab=maintenance`, title: x.plate_number,
        sub: [x.category, x.due_date && formatDate(x.due_date), x.due_odometer != null && formatKm(x.due_odometer)].filter(Boolean).join(' · '),
        when: when(x), urgent: x.status === 'OVERDUE',
      }))} />
    </Card>
  )
}

function Licenses({ data, office }) {
  const to = (license_status) => href('/drivers', { is_active: 'true', license_status }, office)
  return (
    <Card title="Driver licenses" icon={IdCard} tint={severity(data.expired, data.expiring)} action={<ViewAll to={to('')} />}>
      <Counts urgent={[data.expired, 'Expired', to('EXPIRED')]} upcoming={[data.expiring, `Within ${data.window_days} days`, to('EXPIRING')]} />
      <Rows items={data.items.map((x) => ({
        key: x.id, to: `/drivers/${x.id}`, title: x.full_name, sub: `License expires ${formatDate(x.license_expiry_date)}`,
        when: x.days_left < 0 ? `Expired ${daysWord(x.days_left)}` : `Expires ${daysWord(x.days_left)}`, urgent: x.license_status === 'EXPIRED',
      }))} />
    </Card>
  )
}

// Spending: up is not good, so the arrow stays neutral ink; the words carry the direction.
function Delta({ cur, prev, prevLabel }) {
  const c = Number(cur)
  const p = Number(prev)
  if (!p) return null
  const pct = Math.round(((c - p) / p) * 100)
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
      {pct === 0 ? `Same as ${prevLabel}` : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${prevLabel}`}
    </span>
  )
}

function MiniStats({ stats }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {stats.map(([value, label, to]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="sr-only">{label}</dt>
          <dd className="font-semibold text-ink tabular-nums">{to ? <Link to={to} className="hover:text-brand hover:underline">{value}</Link> : value}</dd>
          <span className="text-slate-500" aria-hidden="true">{label.toLowerCase()}</span>
        </div>
      ))}
    </dl>
  )
}

function MoneyTrend({ title, icon, data, to, stats, tooltip }) {
  const trend = data.months.map((m) => ({
    key: m.month, value: Number(m.amount), short: monthShort.format(ymDate(m.month)), label: monthLong.format(ymDate(m.month)), tooltip: tooltip(m),
  }))
  const hasData = trend.some((m) => m.value > 0)
  return (
    <Card title={title} icon={icon} action={<ViewAll to={to}>Open records</ViewAll>}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to={to} className="text-2xl font-semibold text-ink tabular-nums hover:text-brand">{formatPeso(data.amount)}</Link>
        <Delta cur={data.amount} prev={data.previous_amount} prevLabel={trend.at(-2)?.short} />
      </div>
      <MiniStats stats={stats} />
      {hasData ? <div className="mt-3"><TimeBars data={trend} format={formatPeso} valueLabel={title} height="h-32" /></div>
        : <p className="mt-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">Nothing recorded in the last six months.</p>}
    </Card>
  )
}

function Utilization({ u, office, from, to }) {
  const done = href('/trips', { status: 'COMPLETED', date_from: from, date_to: to }, office)
  return (
    <Card title="Utilization" icon={RouteIcon} action={<ViewAll to={done}>Open trips</ViewAll>}>
      <div className="mb-1 flex items-baseline gap-3">
        <span className="text-2xl font-semibold text-ink tabular-nums">{u.rate == null ? '—' : `${u.rate}%`}</span>
        <span className="text-sm text-slate-500">of vehicles used ({u.vehicles_used} of {u.operable})</span>
      </div>
      <div className="mb-3 h-2 rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-2 rounded-full bg-chart" style={{ width: `${u.rate ?? 0}%` }} />
      </div>
      <MiniStats stats={[
        [num.format(u.trips), 'Trips', done], [formatKm(u.distance_km), 'Driven'],
        [num.format(u.on_trip), 'On the road now', href('/trips', { status: 'DISPATCHED' }, office)],
        [num.format(u.scheduled_next_7_days), 'Booked next 7 days', href('/trips', { status: 'SCHEDULED' }, office)],
      ]} />
      <h4 className="mt-4 mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Most driven</h4>
      {u.top_vehicles.length ? (
        <RankBars items={u.top_vehicles.map((t) => ({
          key: t.vehicle, to: `/vehicles/${t.vehicle}?tab=trips`, title: t.plate_number, subtitle: t.label,
          value: t.distance_km, valueText: formatKm(t.distance_km), detail: plural(t.trips, 'trip'),
        }))} />
      ) : <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">No completed trips this month.</p>}
    </Card>
  )
}

function ByOffice({ rows, office }) {
  return (
    <Card title="Vehicles by office" icon={Car}>
      <ul className="space-y-3.5">
        {rows.map((r) => (
          <li key={r.office}>
            <div className="mb-1.5 flex items-baseline gap-2 text-sm">
              <Link to={`/vehicles?office=${r.office}`} className="font-semibold text-brand hover:underline">{r.code}</Link>
              <span className="min-w-0 flex-1 truncate text-slate-500">{r.name}</span>
              <span className="font-semibold text-ink tabular-nums">{num.format(r.total)}</span>
            </div>
            <StatusBar byStatus={r.by_status} total={r.total} height="h-2" office={office} officeId={r.office} />
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-slate-500">Bar colors follow the fleet status legend above.</p>
    </Card>
  )
}

const KIND = {
  vehicle: [Car, 'bg-brand-light text-brand'], document: [FileText, 'bg-slate-100 text-slate-600'],
  fuel: [Fuel, 'bg-green-50 text-green-700'], maintenance: [Wrench, 'bg-amber-50 text-amber-700'], trip: [RouteIcon, 'bg-sky-50 text-sky-700'],
}

// Group by local day: "Today", "Yesterday", then the date.
function dayLabel(iso) {
  const day = new Date(iso).toDateString()
  const today = new Date()
  if (day === today.toDateString()) return 'Today'
  if (day === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(new Date(iso))
}

function Activity({ items }) {
  const groups = []
  for (const a of items) {
    const label = dayLabel(a.at)
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] })
    groups.at(-1).items.push(a)
  }
  return (
    <Section title="Recent activity">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
        {groups.length ? groups.map((g) => (
          <div key={g.label} className="py-2">
            <h3 className="mb-1 text-xs font-medium text-slate-500">{g.label}</h3>
            <ul>
              {g.items.map((a) => {
                const [Icon, tint] = KIND[a.kind]
                return (
                  <li key={`${a.kind}-${a.link}-${a.at}`}>
                    <Link to={a.link} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tint}`}><Icon size={14} aria-hidden="true" /></span>
                      <span className="w-20 shrink-0 font-semibold tracking-wide text-brand">{a.plate_number}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-700">{a.text}</span>
                      <time dateTime={a.at} className="shrink-0 text-xs text-slate-500 tabular-nums">{timeShort.format(new Date(a.at))}</time>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )) : <p className="py-4 text-center text-sm text-slate-500">No activity yet.</p>}
      </div>
    </Section>
  )
}
