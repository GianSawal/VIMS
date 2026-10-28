import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api, useList } from '../../api'
import DataTable from '../../components/DataTable'
import { SearchBox, selectClass, Toolbar } from '../../components/filters'
import { Badge, formatDateTime, Modal, PageHeader } from '../../components/ui'

/*
 * Phase 14. Read-only view of /api/audit-logs/ (System Administrator only; the API enforces it).
 * Entries are never edited here: there is no write endpoint.
 */

// entity_type -> [label, detail page path or null]
const ENTITIES = {
  'fleet.Vehicle': ['Vehicle', (id) => `/vehicles/${id}`],
  'fleet.Driver': ['Driver', (id) => `/drivers/${id}`],
  'fleet.VehicleDocument': ['Document', (id) => `/documents/${id}`],
  'operations.Trip': ['Trip', (id) => `/trips/${id}`],
  'operations.FuelRecord': ['Fuel record', (id) => `/fuel/${id}`],
  'operations.RFIDAccount': ['RFID account', (id) => `/rfid/accounts/${id}`],
  'operations.TollTransaction': ['Toll transaction', null],
  'maintenance.MaintenanceRecord': ['Maintenance', (id) => `/maintenance/${id}`],
  'maintenance.MaintenanceCategory': ['Maintenance category', null],
  'maintenance.MaintenanceSchedule': ['Maintenance schedule', null],
  'accounts.User': ['User', null],
  'accounts.Office': ['Office', null],
  auth: ['Sign-in', null],
  report: ['Report', null],
}
const entityLabel = (t) => ENTITIES[t]?.[0] ?? t

// Action tone: removals/cancellations red, sign-in noise gray, creations green, everything else blue.
const actionTone = (a) => (/cancel|remove|archive|failed/.test(a) ? 'red'
  : /^(login|logout)$/.test(a) ? 'gray' : /create|add|upload|assign$|schedule/.test(a) ? 'green' : 'blue')
const actionLabel = (a) => a.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())

function Record({ row }) {
  const link = ENTITIES[row.entity_type]?.[1]
  const text = `${entityLabel(row.entity_type)}${row.entity_id ? ` #${row.entity_id}` : ''}`
  return link && row.entity_id
    ? <Link to={link(row.entity_id)} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-brand hover:underline">{text}</Link>
    : <span className="whitespace-nowrap text-slate-600">{text}</span>
}

const show = (v) => (v === null || v === undefined || v === '' ? <span className="text-slate-400">(empty)</span>
  : typeof v === 'object' ? <code className="text-xs break-all">{JSON.stringify(v)}</code> : String(v))

/** Before/after table for {'field': [old, new]}; a creation snapshot {'after': {...}} lists the values it was created with. */
export function Changes({ changes }) {
  const entries = Object.entries(changes ?? {})
  if (!entries.length) return <p className="text-sm text-slate-500">No field changes recorded.</p>
  const pairs = entries.filter(([, v]) => Array.isArray(v) && v.length === 2)
  const snapshot = changes.after && typeof changes.after === 'object' && !Array.isArray(changes.after) ? changes.after : null
  const other = entries.filter(([k, v]) => !(Array.isArray(v) && v.length === 2) && !(snapshot && k === 'after'))
  const th = 'px-3 py-2 text-left text-[11px] font-semibold tracking-wider text-slate-500 uppercase'
  return (
    <div className="space-y-4">
      {pairs.length > 0 && (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className={th}>Field</th><th className={th}>Before</th><th className={th}>After</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {pairs.map(([k, [before, after]]) => (
              <tr key={k}>
                <td className="px-3 py-2 align-top font-medium">{k}</td>
                <td className="px-3 py-2 align-top text-slate-600 line-through decoration-slate-300">{show(before)}</td>
                <td className="px-3 py-2 align-top">{show(after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {snapshot && (
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Created with</p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(snapshot).map(([k, v]) => [<dt key={`${k}-k`} className="font-medium">{k}</dt>, <dd key={`${k}-v`}>{show(v)}</dd>])}
          </dl>
        </div>
      )}
      {other.length > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {other.map(([k, v]) => [<dt key={`${k}-k`} className="font-medium">{k}</dt>, <dd key={`${k}-v`}>{show(v)}</dd>])}
        </dl>
      )}
    </div>
  )
}

function Detail({ row, onClose }) {
  return (
    <Modal open={!!row} onClose={onClose} title="Audit entry" wide>
      {row && (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">When</dt><dd>{formatDateTime(row.timestamp)}</dd></div>
            <div><dt className="text-xs text-slate-500">User</dt><dd>{row.username || 'System'}</dd></div>
            <div><dt className="text-xs text-slate-500">Action</dt><dd><Badge tone={actionTone(row.action)}>{actionLabel(row.action)}</Badge></dd></div>
            <div><dt className="text-xs text-slate-500">Record</dt><dd><Record row={row} /></dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Description</dt><dd>{row.description}</dd></div>
            <div><dt className="text-xs text-slate-500">IP address</dt><dd>{row.ip_address || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Browser</dt><dd className="truncate" title={row.user_agent}>{row.user_agent || '—'}</dd></div>
          </dl>
          <div className="border-t border-slate-200 pt-4"><Changes changes={row.changes} /></div>
        </div>
      )}
    </Modal>
  )
}

export default function AuditLogs() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const [open, setOpen] = useState(null)
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

  const filters = { search: f.search, action: f.action, entity_type: f.entity_type, entity_id: f.entity_id, username: f.username,
    date_from: f.date_from, date_to: f.date_to }
  const query = useList('/audit-logs/', { page, ...filters })
  const facets = useQuery({ queryKey: ['/audit-logs/facets/'], queryFn: () => api.get('/audit-logs/facets/').then((r) => r.data) })

  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.action && ['action', `Action: ${actionLabel(f.action)}`],
    f.entity_type && ['entity_type', `Record: ${entityLabel(f.entity_type)}`],
    f.entity_id && ['entity_id', `ID: ${f.entity_id}`],
    f.username && ['username', `User: ${f.username}`],
    f.date_from && ['date_from', `From ${f.date_from}`],
    f.date_to && ['date_to', `To ${f.date_to}`],
  ].filter(Boolean)
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }
  const clearAll = () => { setSearch(''); setParams({}, { replace: true }) }
  const options = (list, label = (v) => v) => (list ?? []).map((o) => <option key={o.value} value={o.value}>{label(o.value)} ({o.count})</option>)

  const toolbar = (
    <Toolbar chips={chips} onRemove={remove} onClear={clearAll}>
      <SearchBox id="audit-search" label="Search audit log" placeholder="Search description, user, record ID…" value={search} onChange={setSearch} />
      <select className={`${selectClass} w-44`} aria-label="Filter by action" value={f.action ?? ''} onChange={(e) => set('action', e.target.value)}>
        <option value="">All actions</option>{options(facets.data?.actions, actionLabel)}
      </select>
      <select className={`${selectClass} w-48`} aria-label="Filter by record type" value={f.entity_type ?? ''} onChange={(e) => set('entity_type', e.target.value)}>
        <option value="">All record types</option>{options(facets.data?.entity_types, entityLabel)}
      </select>
      <select className={`${selectClass} w-40`} aria-label="Filter by user" value={f.username ?? ''} onChange={(e) => set('username', e.target.value)}>
        <option value="">All users</option>{options(facets.data?.usernames)}
      </select>
      <label className="flex items-center gap-2 text-sm text-slate-600">From <input type="date" className={`${selectClass} w-40`} value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm text-slate-600">To <input type="date" className={`${selectClass} w-40`} value={f.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></label>
    </Toolbar>
  )

  const columns = [
    { key: 'timestamp', label: 'When', className: 'whitespace-nowrap', render: (r) => formatDateTime(r.timestamp) },
    { key: 'username', label: 'User', render: (r) => r.username || <span className="text-slate-400">System</span> },
    { key: 'action', label: 'Action', render: (r) => <Badge tone={actionTone(r.action)}>{actionLabel(r.action)}</Badge> },
    { key: 'record', label: 'Record', render: (r) => <Record row={r} /> },
    { key: 'description', label: 'Description', render: (r) => <span className="line-clamp-2">{r.description}</span> },
    { key: 'changes', label: 'Changes', className: 'text-right', render: (r) => {
      const n = Object.keys(r.changes ?? {}).length
      return n ? <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(r) }} className="text-xs font-medium whitespace-nowrap text-brand hover:underline">
        {r.changes.after ? 'View values' : `${n} field${n === 1 ? '' : 's'}`}</button> : null
    } },
  ]

  return (
    <div>
      <PageHeader title="Audit Logs">Who changed what and when. Entries are permanent and cannot be edited or deleted.</PageHeader>
      <DataTable columns={columns} query={query} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
        onRowClick={setOpen} empty="No audit entries match these filters." />
      <Detail row={open} onClose={() => setOpen(null)} />
    </div>
  )
}
