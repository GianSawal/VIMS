import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Paperclip, Plus, RefreshCw } from 'lucide-react'
import { useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { Button, Modal } from '../../components/ui'
import { daysText, DocBadge } from '../documents/common'
import DocumentForm from '../documents/DocumentForm'
import { documentColumns } from '../documents/DocumentList'
import { formatDate } from './common'

const edge = { EXPIRED: 'border-red-200 border-l-danger', 7: 'border-red-200 border-l-danger', 15: 'border-amber-200 border-l-amber-500', 30: 'border-amber-200 border-l-amber-500', 60: 'border-brand/20 border-l-brand' }

export default function DocumentsTab({ v }) {
  const can = useCan()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null) // 'add' | document to renew
  const current = useList('/documents/', { vehicle: v.id, status: 'ACTIVE', page_size: 50 })
  const all = useList('/documents/', { vehicle: v.id, page, ordering: '-created_at' })
  const canRenew = can('fleet.add_vehicledocument') && can('fleet.change_vehicledocument')

  return (
    <div className="space-y-4">
      <section aria-labelledby="cur-docs">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="cur-docs" className="mr-auto font-semibold text-ink">Current documents</h2>
          {can('fleet.add_vehicledocument') && !v.is_archived && <Button onClick={() => setDialog('add')}><Plus size={16} /> Add document</Button>}
        </div>
        {current.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
          : current.data?.results.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {current.data.results.map((d) => (
                <article key={d.id} className={`rounded-xl border border-l-4 bg-white p-4 shadow-sm ${edge[d.expiry?.band] ?? 'border-slate-200 border-l-green-500'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/documents/${d.id}`} className="font-semibold text-ink hover:text-brand hover:underline">{d.document_type_display}</Link>
                      <div className="truncate font-mono text-xs text-slate-500">{d.reference_number || 'No reference number'}</div>
                    </div>
                    <DocBadge doc={d} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-slate-500">Issued</dt><dd>{formatDate(d.issue_date)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Expires</dt><dd>{d.expiry_date ? formatDate(d.expiry_date) : 'No expiry'}</dd></div>
                  </dl>
                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-xs">
                    <span className={`mr-auto ${['EXPIRED', '7'].includes(d.expiry?.band) ? 'font-medium text-danger' : 'text-slate-600'}`}>{daysText(d.expiry) ?? 'Does not expire'}</span>
                    {d.file && <a href={d.file} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline"><Paperclip size={12} aria-hidden="true" /> Scan</a>}
                    {canRenew && d.expiry_date && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setDialog(d)}><RefreshCw size={14} /> Renew</Button>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No documents for this vehicle yet. Add its LTO registration, OR/CR and GSIS insurance to get renewal alerts.
            </div>
          )}
      </section>

      <section aria-labelledby="all-docs">
        <h2 id="all-docs" className="mb-2 font-semibold text-ink">All records, including renewed and cancelled</h2>
        <DataTable columns={documentColumns({ withVehicle: false })} query={all} page={page} onPage={setPage}
          onRowClick={(d) => navigate(`/documents/${d.id}`)} empty="No documents recorded for this vehicle yet." />
      </section>

      <Modal open={!!dialog} onClose={() => setDialog(null)} title={dialog === 'add' ? `Add document: ${v.plate_number}` : `Renew ${dialog?.document_type_display ?? ''}`} wide>
        {dialog === 'add' && <DocumentForm vehicle={v} onClose={() => setDialog(null)} />}
        {dialog && dialog !== 'add' && <DocumentForm doc={dialog} renew onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}
