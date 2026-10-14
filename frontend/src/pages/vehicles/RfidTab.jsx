import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CreditCard, Plus } from 'lucide-react'
import { useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { Badge, Button, Modal } from '../../components/ui'
import { ProviderBadge } from '../rfid/common'
import { tollColumns } from '../rfid/RfidList'
import RfidForm from '../rfid/RfidForm'
import TollForm from '../rfid/TollForm'
import { formatPeso } from './common'

export default function RfidTab({ v }) {
  const can = useCan()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null) // 'account' | 'toll'
  const accounts = useList('/rfid-accounts/', { vehicle: v.id, page_size: 50 })
  const tolls = useList('/toll-transactions/', { vehicle: v.id, page })

  return (
    <div className="space-y-4">
      <section aria-labelledby="rfid-accts">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="rfid-accts" className="mr-auto font-semibold text-ink">RFID / toll accounts</h2>
          {can('operations.add_tolltransaction') && !v.is_archived && <Button variant="secondary" onClick={() => setDialog('toll')}><Plus size={16} /> Record toll</Button>}
          {can('operations.add_rfidaccount') && !v.is_archived && <Button onClick={() => setDialog('account')}><CreditCard size={16} /> Add account</Button>}
        </div>
        {accounts.isLoading ? <div className="h-20 animate-pulse rounded-xl bg-slate-200" />
          : accounts.data?.results.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {accounts.data.results.map((a) => (
                <Link key={a.id} to={`/rfid/accounts/${a.id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand">
                  <div className="flex items-center justify-between gap-2">
                    <ProviderBadge provider={a.provider} />
                    <Badge tone={a.is_active ? 'green' : 'gray'} dot>{a.is_active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <div className="mt-2 font-mono text-lg font-semibold tracking-wider text-ink">{a.account_number}</div>
                  <div className="mt-2 flex items-baseline justify-between text-sm">
                    <span className="text-slate-500">Recorded balance</span>
                    <span className="font-semibold tabular-nums">{a.balance != null ? formatPeso(a.balance) : '—'}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No RFID account assigned to this vehicle yet.
            </div>
          )}
      </section>

      <section aria-labelledby="rfid-hist">
        <h2 id="rfid-hist" className="mb-2 font-semibold text-ink">Toll history</h2>
        <DataTable columns={tollColumns({ withVehicle: false })} query={tolls} page={page} onPage={setPage}
          onRowClick={can('operations.change_tolltransaction') ? (t) => setDialog(t) : undefined}
          empty="No toll transactions recorded for this vehicle yet." />
      </section>

      <Modal open={dialog === 'account'} onClose={() => setDialog(null)} title={`Add RFID account: ${v.plate_number}`} wide>
        {dialog === 'account' && <RfidForm vehicle={v} onClose={() => setDialog(null)} onSaved={(a) => navigate(`/rfid/accounts/${a.id}`)} />}
      </Modal>
      <Modal open={dialog === 'toll' || (!!dialog && typeof dialog === 'object')} onClose={() => setDialog(null)}
        title={typeof dialog === 'object' && dialog ? 'Edit toll transaction' : `Record toll: ${v.plate_number}`} wide>
        {(dialog === 'toll' || (dialog && typeof dialog === 'object')) && <TollForm vehicle={v} txn={typeof dialog === 'object' ? dialog : undefined} onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}
