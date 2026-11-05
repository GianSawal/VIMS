import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownCircle, ArrowUpCircle, Pencil, Plus, Scale, Wallet } from 'lucide-react'
import { api, errorMessage, invalidatePrefix } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { Badge, Button, Field, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { NotFound } from '../Errors'
import { formatPeso } from '../vehicles/common'
import { ProviderBadge } from './common'
import { tollColumns } from './RfidList'
import RfidForm from './RfidForm'
import TollForm from './TollForm'
import DeleteRecord from '../../components/DeleteRecord'

export default function RfidDetail() {
  const { id } = useParams()
  const can = useCan()
  const [dialog, setDialog] = useState(null) // 'edit' | 'toll' | 'opening' | a transaction
  const q = useQuery({ queryKey: ['/rfid-accounts/', id], queryFn: () => api.get(`/rfid-accounts/${id}/`).then((r) => r.data) })
  const tx = useQuery({ queryKey: ['/rfid-accounts/', id, 'transactions'], queryFn: () => api.get(`/rfid-accounts/${id}/transactions/`).then((r) => r.data) })
  const a = q.data

  if (q.isLoading) return <div className="animate-pulse space-y-3"><div className="h-8 w-56 rounded bg-slate-200" /><div className="h-56 rounded-xl bg-slate-200" /></div>
  if (q.error?.response?.status === 404) return <NotFound />
  if (q.isError) return <div className="text-danger">{errorMessage(q.error)}</div>

  const canChange = can('operations.change_rfidaccount')
  const txQuery = { data: tx.data ? { count: tx.data.results.length, results: tx.data.results } : undefined, isLoading: tx.isLoading, isError: tx.isError, error: tx.error, isFetching: tx.isFetching }

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/rfid" className="hover:underline">RFID / Toll</Link> / <span aria-current="page">{a.provider_display} {a.masked_account}</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-wider text-ink">{a.account_number}</h1>
            <ProviderBadge provider={a.provider} />
            <Badge tone={a.is_active ? 'green' : 'gray'} dot>{a.is_active ? 'Active' : 'Inactive'}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {a.vehicle
              ? <>Assigned to <Link to={`/vehicles/${a.vehicle}?tab=rfid`} className="font-semibold tracking-wide text-brand hover:underline">{a.plate_number}</Link> · {a.vehicle_label}</>
              : 'Unassigned (motor pool)'}
          </p>
        </div>
        {canChange && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil size={16} /> Edit</Button>}
        <DeleteRecord path={`/rfid-accounts/${a.id}/`} perm="operations.delete_rfidaccount" name={`${a.provider_display} ${a.masked_account}`} kind="RFID account" listPath="/rfid" />
        {/* Never transacted: the card may already hold money from before it was encoded here. */}
        {can('operations.add_tolltransaction') && a.transaction_count === 0 && a.vehicle && (
          <Button variant="secondary" onClick={() => setDialog('opening')}><Wallet size={16} /> Set starting balance</Button>
        )}
        {can('operations.add_tolltransaction') && <Button onClick={() => setDialog('toll')}><Plus size={16} /> Record toll</Button>}
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Metric icon={ArrowUpCircle} tint="bg-emerald-50 text-emerald-700" label="Total loads" value={tx.data ? formatPeso(tx.data.credit) : '…'} />
        <Metric icon={ArrowDownCircle} tint="bg-red-50 text-danger" label="Total charges" value={tx.data ? formatPeso(tx.data.debit) : '…'} />
        <Metric icon={Scale} tint="bg-brand-light text-brand" label="Current balance" value={formatPeso(a.current_balance)} hint="Loads − charges" />
      </div>

      {a.remarks && <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 text-sm whitespace-pre-line text-slate-700"><span className="mb-1 block text-xs text-slate-500">Remarks</span>{a.remarks}</div>}

      <h2 className="mb-2 font-semibold text-ink">Transaction history</h2>
      <DataTable columns={tollColumns({ withBalance: true })} query={txQuery} footer={false}
        onRowClick={can('operations.change_tolltransaction') ? (t) => setDialog(t) : undefined}
        empty="No toll transactions recorded for this account yet." />

      <Modal open={dialog === 'edit'} onClose={() => setDialog(null)} title="Edit RFID account" wide>
        {dialog === 'edit' && <RfidForm account={a} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'opening'} onClose={() => setDialog(null)} title="Set starting balance">
        {dialog === 'opening' && <OpeningBalanceForm a={a} onClose={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog === 'toll' || (!!dialog && typeof dialog === 'object')} onClose={() => setDialog(null)}
        title={typeof dialog === 'object' && dialog ? 'Edit toll transaction' : 'Record toll transaction'} wide>
        {(dialog === 'toll' || (dialog && typeof dialog === 'object')) && <TollForm account={a} txn={typeof dialog === 'object' ? dialog : undefined} onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}

function OpeningBalanceForm({ a, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () => api.post(`/rfid-accounts/${a.id}/opening-balance/`, { opening_balance: amount.replace(/,/g, '').trim() }),
    onSuccess: () => {
      invalidatePrefix(qc, '/rfid-accounts/', '/toll-transactions/', '/dashboard/')
      toast('Starting balance recorded.')
      onClose()
    },
    onError: (err) => setError(errorMessage(err)),
  })
  return (
    <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <p className="text-sm text-slate-600">
        The balance already on {a.provider_display} {a.masked_account} before it was added to the system. It is saved as an
        &quot;Opening balance&quot; load and can only be set while the account has no transactions.
      </p>
      <Field label="Starting balance (₱) *" htmlFor="opening-amount">
        <input id="opening-amount" className={inputClass} inputMode="decimal" placeholder="0.00" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending || !(Number(amount.replace(/,/g, '')) > 0)}>{save.isPending ? 'Saving…' : 'Save balance'}</Button>
      </div>
    </form>
  )
}

function Metric({ icon: Icon, tint, label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-slate-500"><span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tint}`}><Icon size={16} aria-hidden="true" /></span>{label}</div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

