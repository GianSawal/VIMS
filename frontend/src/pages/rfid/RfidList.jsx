import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownCircle, ArrowUpCircle, CreditCard, Plus, Scale, Wallet } from 'lucide-react'
import { useList } from '../../api'
import { useCan, useMe } from '../../auth'
import DataTable from '../../components/DataTable'
import { CardGrid, SearchBox, selectClass, StatCard, Toolbar } from '../../components/filters'
import { Badge, Button, formatDateTime, Modal, PageHeader } from '../../components/ui'
import { useAllOffices } from '../admin/Offices'
import { formatPeso, VehiclePhoto } from '../vehicles/common'
import { isLoad, PROVIDERS, ProviderBadge, providerLabel } from './common'
import RfidForm from './RfidForm'
import TollForm from './TollForm'

const vehicleCell = (r) => (
  <div className="flex items-center gap-3">
    <VehiclePhoto vehicle={{ photo_url: r.vehicle_photo_url, plate_number: r.plate_number, make: '', model: r.vehicle_label }} className="w-14 shrink-0 border border-slate-200" />
    <div className="min-w-0"><div className="font-semibold tracking-wide">{r.plate_number}</div><div className="truncate text-xs text-slate-500">{r.vehicle_label}</div></div>
  </div>
)

/** Account rows, shared with the vehicle RFID tab (`withVehicle` = false there). */
export function accountColumns({ withVehicle = true } = {}) {
  return [
    { key: 'provider', label: 'Provider', render: (a) => <ProviderBadge provider={a.provider} /> },
    { key: 'account', label: 'Account number', render: (a) => <span className="font-mono text-sm tracking-wider">{a.account_number}</span> },
    ...(withVehicle ? [{ key: 'vehicle', label: 'Vehicle', render: (a) => (a.vehicle
      ? vehicleCell(a)
      : <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Unassigned</span>) }] : []),
    { key: 'balance', label: 'Recorded balance', className: 'text-right', render: (a) => (a.balance != null ? <span className="font-semibold tabular-nums">{formatPeso(a.balance)}</span> : <span className="text-slate-400">—</span>) },
    { key: 'txns', label: 'Transactions', className: 'text-right tabular-nums', render: (a) => a.transaction_count },
    { key: 'status', label: 'Status', render: (a) => <Badge tone={a.is_active ? 'green' : 'gray'} dot>{a.is_active ? 'Active' : 'Inactive'}</Badge> },
  ]
}

/** Toll transaction rows, shared with the vehicle RFID tab (`withVehicle` = false there). */
export function tollColumns({ withVehicle = true, withBalance = false } = {}) {
  return [
    { key: 'when', label: 'Date & time', render: (t) => <span className="whitespace-nowrap">{formatDateTime(t.transacted_at)}</span> },
    ...(withVehicle ? [{ key: 'vehicle', label: 'Vehicle', render: vehicleCell }] : []),
    { key: 'desc', label: 'Description', render: (t) => (
      <div className="min-w-0 max-w-72">
        <div className="truncate" title={t.description}>{t.description}</div>
        <div className="truncate text-xs text-slate-500">{providerLabel[t.provider_display] ?? t.provider_display} {t.account_masked?.split(' ').slice(-2).join(' ')}{t.reference_number && ` · ${t.reference_number}`}</div>
      </div>
    ) },
    { key: 'trip', label: 'Trip', render: (t) => (t.trip ? <Link to={`/trips/${t.trip}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand hover:underline">{t.trip_ticket}</Link> : <span className="text-slate-400">—</span>) },
    { key: 'amount', label: 'Amount', className: 'text-right', render: (t) => (isLoad(t)
      ? <span className="font-semibold text-emerald-700 tabular-nums">+{formatPeso(t.credit)}</span>
      : <span className="font-semibold text-danger tabular-nums">−{formatPeso(t.debit)}</span>) },
    ...(withBalance ? [{ key: 'balance', label: 'Balance', className: 'text-right', render: (t) => <span className="tabular-nums">{formatPeso(t.running_balance)}</span> }] : []),
  ]
}

export default function RfidList() {
  const can = useCan()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const offices = useAllOffices()
  const [dialog, setDialog] = useState(null) // 'account' | 'toll'
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const f = Object.fromEntries(params)
  const page = Number(f.page ?? 1)
  const tolls = f.view === 'transactions'

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

  const common = { search: f.search, office: f.office, provider: f.provider }
  const accounts = useList('/rfid-accounts/', { page, ...common, is_active: f.active, unassigned: f.unassigned })
  const tollList = useList('/toll-transactions/', { page, ...common, kind: f.kind, date_from: f.date_from, date_to: f.date_to })
  const tollSummary = useList('/toll-transactions/summary/', common)

  const showOffice = me?.view_all_offices || (me?.offices.length ?? 0) > 1
  const chips = [
    f.search && ['search', `Search: “${f.search}”`],
    f.office && ['office', `Office: ${offices.data?.results.find((o) => String(o.id) === f.office)?.code ?? f.office}`],
    f.provider && ['provider', `Provider: ${providerLabel[f.provider] ?? f.provider}`],
    !tolls && f.active && ['active', f.active === 'true' ? 'Active only' : 'Inactive only'],
    !tolls && f.unassigned && ['unassigned', 'Unassigned'],
    tolls && f.kind && ['kind', f.kind === 'credit' ? 'Loads only' : 'Charges only'],
    tolls && f.date_from && ['date_from', `From ${f.date_from}`],
    tolls && f.date_to && ['date_to', `To ${f.date_to}`],
  ].filter(Boolean)
  const remove = (key) => { if (key === 'search') setSearch(''); set(key, '') }
  const clearAll = () => { setSearch(''); setParams(tolls ? { view: 'transactions' } : {}, { replace: true }) }

  const toolbar = (
    <Toolbar chips={chips} onRemove={remove} onClear={clearAll}>
      <SearchBox id="rfid-search" label="Search" placeholder={tolls ? 'Search plate, description, ref no.…' : 'Search account no., plate, remarks…'} value={search} onChange={setSearch} />
      {showOffice && (
        <select className={`${selectClass} w-44`} aria-label="Filter by office" value={f.office ?? ''} onChange={(e) => set('office', e.target.value)}>
          <option value="">All offices</option>
          {offices.data?.results.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      )}
      <select className={`${selectClass} w-40`} aria-label="Filter by provider" value={f.provider ?? ''} onChange={(e) => set('provider', e.target.value)}>
        <option value="">All providers</option>
        {PROVIDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {!tolls && (
        <select className={`${selectClass} w-40`} aria-label="Filter by status" value={f.active ?? ''} onChange={(e) => set('active', e.target.value)}>
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      )}
      {tolls && <>
        <select className={`${selectClass} w-36`} aria-label="Filter by type" value={f.kind ?? ''} onChange={(e) => set('kind', e.target.value)}>
          <option value="">Loads & charges</option>
          <option value="debit">Charges</option>
          <option value="credit">Loads</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">From <input type="date" className={`${selectClass} w-40`} value={f.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-600">To <input type="date" className={`${selectClass} w-40`} value={f.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></label>
      </>}
    </Toolbar>
  )

  return (
    <div>
      <PageHeader title="RFID / Toll" actions={(
        <div className="flex gap-2">
          {can('operations.add_tolltransaction') && <Button variant="secondary" onClick={() => setDialog('toll')}><Plus size={16} /> Record toll</Button>}
          {can('operations.add_rfidaccount') && <Button onClick={() => setDialog('account')}><CreditCard size={16} /> Add account</Button>}
        </div>
      )}>Easytrip / Autosweep accounts and their toll loads and charges.</PageHeader>

      <div role="tablist" aria-label="RFID views" className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
        {[['', 'Accounts', CreditCard], ['transactions', 'Toll transactions', Wallet]].map(([v, label, Icon]) => (
          <button key={label} role="tab" aria-selected={(f.view ?? '') === v}
            onClick={() => setParams(v ? { view: v } : {}, { replace: true })}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 font-medium ${(f.view ?? '') === v ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {tolls ? (
        <>
          <CardGrid label="Toll totals">
            <StatCard icon={Wallet} tint="bg-slate-100 text-slate-700" label="Transactions" count={tollSummary.data?.total} loading={tollSummary.isLoading} />
            <StatCard icon={ArrowUpCircle} tint="bg-emerald-50 text-emerald-700" label="Loads" count={tollSummary.data && formatPeso(tollSummary.data.credit)} loading={tollSummary.isLoading} selected={f.kind === 'credit'} onClick={() => set('kind', f.kind === 'credit' ? '' : 'credit')} />
            <StatCard icon={ArrowDownCircle} tint="bg-red-50 text-danger" label="Charges" count={tollSummary.data && formatPeso(tollSummary.data.debit)} loading={tollSummary.isLoading} selected={f.kind === 'debit'} onClick={() => set('kind', f.kind === 'debit' ? '' : 'debit')} />
            <StatCard icon={Scale} tint="bg-brand-light text-brand" label="Net balance" count={tollSummary.data && formatPeso(tollSummary.data.net)} loading={tollSummary.isLoading} />
          </CardGrid>
          <DataTable columns={tollColumns()} query={tollList} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
            onRowClick={can('operations.change_tolltransaction') ? (t) => setDialog(t) : undefined}
            empty={chips.length ? 'No transactions match these filters.' : 'No toll transactions yet.'} />
        </>
      ) : (
        <DataTable columns={accountColumns()} query={accounts} page={page} onPage={(p) => set('page', String(p))} toolbar={toolbar}
          onRowClick={(a) => navigate(`/rfid/accounts/${a.id}`)}
          empty={chips.length ? 'No accounts match these filters.' : 'No RFID accounts yet. Add your Easytrip / Autosweep accounts to track toll.'} />
      )}

      <Modal open={dialog === 'account'} onClose={() => setDialog(null)} title="Add RFID account" wide>
        {dialog === 'account' && <RfidForm onClose={() => setDialog(null)} onSaved={(a) => navigate(`/rfid/accounts/${a.id}`)} />}
      </Modal>
      <Modal open={dialog === 'toll' || (!!dialog && typeof dialog === 'object')} onClose={() => setDialog(null)}
        title={typeof dialog === 'object' && dialog ? 'Edit toll transaction' : 'Record toll transaction'} wide>
        {(dialog === 'toll' || (dialog && typeof dialog === 'object')) && <TollForm txn={typeof dialog === 'object' ? dialog : undefined} onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}
