import { useSearchParams, Link } from 'react-router-dom'
import {
  Ban, Car, CircleCheck, FileText, Fuel, IdCard, LayoutList, Navigation, Route as RouteIcon, ShieldCheck,
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

const STATUS_CARDS = [
  ['', 'All vehicles', LayoutList, 'bg-slate-100 text-slate-700'],
  ['SERVICEABLE', 'Serviceable', CircleCheck, 'bg-green-50 text-green-700'],
  ['IN_USE', 'In use', Navigation, 'bg-brand-light text-brand'],
  ['UNDER_MAINTENANCE', 'Under maintenance', Wrench, 'bg-amber-50 text-amber-700'],
  ['FOR_REPAIR', 'For repair', TriangleAlert, 'bg-orange-50 text-orange-700'],
  ['UNSERVICEABLE', 'Unserviceable', Ban, 'bg-red-50 text-danger'],
]

const monthShort = new Intl.DateTimeFormat('en-PH', { month: 'short' })
const monthLong = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' })
const num = new Intl.NumberFormat('en-PH')
const liters = (v) => `${num.format(Number(v))} L`
const ymDate = (ym) => new Date(`${ym}-01T00:00:00`)

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

const relative = new Intl.RelativeTimeFormat('en-PH', { numeric: 'auto' })
function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000)
  if (mins < 60) return relative.format(-mins, 'minute')
  if (mins < 60 * 24) return relative.format(-Math.round(mins / 60), 'hour')
  return relative.format(-Math.round(mins / 1440), 'day')
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
  const monthName = selectedMonth ? monthLong.format(ymDate(selectedMonth)) : ''

  return (
    <div>
      <PageHeader title="Dashboard" actions={
        <div className="flex flex-wrap items-center gap-2">
          {showOffice && (
            <select className={`${selectClass} w-48`} aria-label="Office" value={office} onChange={(e) => set('office', e.target.value)}>
              <option value="">All my offices</option>
              {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Month <input type="month" className={`${selectClass} w-40`} value={selectedMonth} max={d?.today?.slice(0, 7)}
              onChange={(e) => set('month', e.target.value)} />
          </label>
        </div>
      }>Fleet status, what needs attention, and {monthName || 'this month'} at a glance.</PageHeader>

      {query.isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-danger">The dashboard could not be loaded. Please refresh the page.</p>
      ) : (
        <div className="space-y-4">
          {(query.isLoading || d?.vehicles) && <StatusCards v={d?.vehicles} loading={query.isLoading} office={office} />}

          {query.isLoading ? <Skeleton className="h-64" /> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {d.renewals && <ExpiryWidget icon={Car} title="LTO registration" data={d.renewals.lto} window={d.renewals.window_days}
                all={href('/documents', { type: 'LTO_REGISTRATION' }, office)}
                expiredTo={href('/documents', { type: 'LTO_REGISTRATION', band: 'EXPIRED' }, office)} />}
              {d.renewals && <ExpiryWidget icon={ShieldCheck} title="GSIS / insurance" data={d.renewals.insurance} window={d.renewals.window_days}
                all={href('/documents', { type: 'GSIS_INSURANCE,INSURANCE_POLICY' }, office)}
                expiredTo={href('/documents', { type: 'GSIS_INSURANCE,INSURANCE_POLICY', band: 'EXPIRED' }, office)} />}
              {d.maintenance_due && <MaintenanceDue data={d.maintenance_due} office={office} />}
              {d.licenses && <Licenses data={d.licenses} office={office} />}
            </div>
          )}

          {!query.isLoading && (d.fuel || d.maintenance_cost) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {d.fuel && (
                <MoneyTrend title="Fuel" icon={Fuel} data={d.fuel} monthName={monthName}
                  to={href('/fuel', { date_from: from, date_to: to }, office)}
                  sub={`${liters(d.fuel.liters)} · ${num.format(d.fuel.count)} fill-up${d.fuel.count === 1 ? '' : 's'}`}
                  tooltip={(m) => [`Cost: ${formatPeso(m.amount)}`, `Fuel: ${liters(m.liters)}`]} />
              )}
              {d.maintenance_cost && (
                <MoneyTrend title="Maintenance cost" icon={Wrench} data={d.maintenance_cost} monthName={monthName}
                  to={href('/maintenance', { status: 'COMPLETED', date_from: from, date_to: to }, office)}
                  sub={<>{num.format(d.maintenance_cost.count)} completed · <Link className="text-brand hover:underline" to={href('/maintenance', { status: '' }, office)}>{num.format(d.maintenance_cost.open)} open</Link></>}
                  tooltip={(m) => [`Cost: ${formatPeso(m.amount)}`, `${m.count} completed`]} />
              )}
            </div>
          )}

          {!query.isLoading && (d.utilization || d.vehicles) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {d.utilization && <Utilization u={d.utilization} monthName={monthName} office={office} from={from} to={to} />}
              {d.vehicles && <ByOffice rows={d.vehicles.by_office} />}
            </div>
          )}

          {!query.isLoading && <Activity items={d.activity} />}
        </div>
      )}
    </div>
  )
}

function Skeleton({ className }) {
  return <div className={`animate-pulse rounded-xl bg-slate-100 ${className}`} />
}

function Card({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        {Icon && <Icon size={18} className="text-brand" aria-hidden="true" />}
        <h2 className="mr-auto font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const ViewAll = ({ to, children = 'View all' }) => <Link to={to} className="text-xs font-medium text-brand hover:underline">{children}</Link>

function StatusCards({ v, loading, office }) {
  return (
    <div role="group" aria-label="Vehicles by status" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {STATUS_CARDS.map(([status, label, Icon, tint]) => (
        <Link key={label} to={href('/vehicles', { status }, office)}
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm transition hover:border-slate-300 hover:shadow-md">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tint}`}><Icon size={18} aria-hidden="true" /></span>
          <span className="min-w-0">
            {loading ? <span className="block h-6 w-8 animate-pulse rounded bg-slate-200" />
              : <span className="block text-xl leading-none font-semibold text-ink tabular-nums">{num.format(status ? v.by_status[status] : v.total)}</span>}
            <span className="mt-1 block truncate text-xs text-slate-500">{label}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}

// Two headline counts (urgent in danger red, upcoming in amber) that link to the filtered list.
function Counts({ urgent, upcoming }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2">
      {[[urgent, 'text-danger'], [upcoming, 'text-amber-700']].map(([[n, label, to], tone]) => (
        <Link key={label} to={to} className="rounded-lg bg-slate-50 px-3 py-2 hover:bg-slate-100">
          <span className={`block text-xl leading-none font-semibold tabular-nums ${n ? tone : 'text-slate-400'}`}>{num.format(n)}</span>
          <span className="mt-1 block text-xs text-slate-500">{label}</span>
        </Link>
      ))}
    </div>
  )
}

function Rows({ items, empty }) {
  if (!items.length) return <p className="py-4 text-center text-sm text-slate-500">{empty}</p>
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {items.map((i) => (
        <li key={i.key}>
          <Link to={i.to} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 hover:bg-slate-50">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{i.title}</span>
              <span className="block truncate text-xs text-slate-500">{i.sub}</span>
            </span>
            <span className={`shrink-0 text-xs font-medium whitespace-nowrap ${i.urgent ? 'text-danger' : 'text-amber-700'}`}>{i.when}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const daysWord = (n) => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} ago` : n === 0 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`)

function ExpiryWidget({ icon, title, data, window, all, expiredTo }) {
  return (
    <Card title={title} icon={icon} action={<ViewAll to={all} />}>
      <Counts urgent={[data.expired, 'Expired', expiredTo]} upcoming={[data.due, `Within ${window} days`, all]} />
      <Rows empty="Nothing expiring soon." items={data.items.map((x) => ({
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
    if (x.days_left != null) parts.push(x.days_left < 0 ? `${-x.days_left} d over` : `${x.days_left} d`)
    if (x.km_left != null) parts.push(x.km_left < 0 ? `${num.format(-x.km_left)} km over` : `${num.format(x.km_left)} km`)
    return parts.join(' / ')
  }
  return (
    <Card title="Maintenance due" icon={Wrench} action={<ViewAll to={to('')} />}>
      <Counts urgent={[data.overdue, 'Overdue', to('OVERDUE')]} upcoming={[data.due_soon, 'Due soon', to('DUE_SOON')]} />
      <Rows empty="No preventive maintenance due." items={data.items.map((x) => ({
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
    <Card title="Driver licenses" icon={IdCard} action={<ViewAll to={to('')} />}>
      <Counts urgent={[data.expired, 'Expired', to('EXPIRED')]} upcoming={[data.expiring, `Within ${data.window_days} days`, to('EXPIRING')]} />
      <Rows empty="No licenses expiring soon." items={data.items.map((x) => ({
        key: x.id, to: `/drivers/${x.id}`, title: x.full_name, sub: `License expires ${formatDate(x.license_expiry_date)}`,
        when: x.days_left < 0 ? `Expired ${daysWord(x.days_left)}` : daysWord(x.days_left), urgent: x.license_status === 'EXPIRED',
      }))} />
    </Card>
  )
}

function Delta({ cur, prev, prevLabel }) {
  const c = Number(cur)
  const p = Number(prev)
  if (!p) return null
  const pct = Math.round(((c - p) / p) * 100)
  return <span className="text-xs text-slate-500">{pct === 0 ? 'Same as' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs`} {prevLabel}</span>
}

function MoneyTrend({ title, icon, data, monthName, to, sub, tooltip }) {
  const trend = data.months.map((m) => ({
    key: m.month, value: Number(m.amount), short: monthShort.format(ymDate(m.month)), label: monthLong.format(ymDate(m.month)), tooltip: tooltip(m),
  }))
  return (
    <Card title={title} icon={icon} action={<ViewAll to={to}>Open records</ViewAll>}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link to={to} className="text-2xl font-semibold text-ink tabular-nums hover:text-brand">{formatPeso(data.amount)}</Link>
        <span className="text-sm text-slate-500">{monthName}</span>
        <Delta cur={data.amount} prev={data.previous_amount} prevLabel={trend.at(-2)?.short} />
      </div>
      <p className="mb-2 text-sm text-slate-600">{sub}</p>
      {trend.some((m) => m.value > 0) ? <TimeBars data={trend} format={formatPeso} valueLabel={title} height="h-40" />
        : <p className="py-10 text-center text-sm text-slate-500">No {title.toLowerCase()} recorded in the last six months.</p>}
    </Card>
  )
}

function Utilization({ u, monthName, office, from, to }) {
  const stats = [
    [u.rate == null ? '—' : `${u.rate}%`, `Vehicles used (${u.vehicles_used} of ${u.operable})`, href('/trips', { status: 'COMPLETED', date_from: from, date_to: to }, office)],
    [num.format(u.trips), 'Completed trips', href('/trips', { status: 'COMPLETED', date_from: from, date_to: to }, office)],
    [formatKm(u.distance_km), 'Distance driven', href('/trips', { status: 'COMPLETED', date_from: from, date_to: to }, office)],
    [num.format(u.on_trip), 'On a trip now', href('/trips', { status: 'DISPATCHED' }, office)],
  ]
  return (
    <Card title="Utilization" icon={RouteIcon} action={<span className="text-xs text-slate-500">{monthName}</span>}>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([value, label, link]) => (
          <Link key={label} to={link} className="rounded-lg bg-slate-50 px-3 py-2 hover:bg-slate-100">
            <span className="block text-lg leading-none font-semibold text-ink tabular-nums">{value}</span>
            <span className="mt-1 block text-xs text-slate-500">{label}</span>
          </Link>
        ))}
      </div>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Most driven</h3>
      {u.top_vehicles.length ? (
        <RankBars items={u.top_vehicles.map((t) => ({
          key: t.vehicle, to: `/vehicles/${t.vehicle}?tab=trips`, title: t.plate_number, subtitle: t.label,
          value: t.distance_km, valueText: formatKm(t.distance_km), detail: `${t.trips} trip${t.trips === 1 ? '' : 's'}`,
        }))} />
      ) : <p className="py-4 text-center text-sm text-slate-500">No completed trips this month.</p>}
      {u.scheduled_next_7_days > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          <Link to={href('/trips', { status: 'SCHEDULED' }, office)} className="font-medium text-brand hover:underline">{u.scheduled_next_7_days} trip{u.scheduled_next_7_days === 1 ? '' : 's'}</Link> scheduled in the next 7 days.
        </p>
      )}
    </Card>
  )
}

function ByOffice({ rows }) {
  return (
    <Card title="Vehicles by office" icon={Car}>
      {rows.length ? (
        <RankBars items={rows.map((r) => ({
          key: r.office, to: `/vehicles?office=${r.office}`, title: r.code, subtitle: r.name, value: r.total,
          valueText: num.format(r.total), detail: `${r.by_status.SERVICEABLE} serviceable`,
        }))} />
      ) : <p className="py-4 text-center text-sm text-slate-500">No vehicles yet.</p>}
    </Card>
  )
}

const KIND = { vehicle: Car, document: FileText, fuel: Fuel, maintenance: Wrench, trip: RouteIcon }

function Activity({ items }) {
  return (
    <Card title="Recent activity">
      {items.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((a) => {
            const Icon = KIND[a.kind]
            return (
              <li key={`${a.kind}-${a.link}-${a.at}`}>
                <Link to={a.link} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-50">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon size={16} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1 truncate"><span className="font-semibold tracking-wide text-brand">{a.plate_number}</span> <span className="text-slate-700">{a.text}</span></span>
                  <time dateTime={a.at} title={new Date(a.at).toLocaleString('en-PH')} className="shrink-0 text-xs text-slate-500">{ago(a.at)}</time>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : <p className="py-4 text-center text-sm text-slate-500">No activity yet.</p>}
    </Card>
  )
}
