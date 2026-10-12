import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarX2, ExternalLink, FileText, Paperclip, Pencil, RefreshCw, XCircle } from 'lucide-react'
import { api, errorMessage, invalidatePrefix } from '../../api'
import { useCan } from '../../auth'
import { Button, Field, formatDateTime, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { NotFound } from '../Errors'
import { formatDate, VehiclePhoto } from '../vehicles/common'
import { daysText, DocBadge } from './common'
import DocumentForm from './DocumentForm'

const urgent = (d) => d.expiry && ['EXPIRED', '7'].includes(d.expiry.band)
const soon = (d) => d.expiry && ['15', '30', '60'].includes(d.expiry.band)

export default function DocumentDetail() {
  const { id } = useParams()
  const can = useCan()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState(null) // 'edit' | 'renew' | 'cancel'
  const q = useQuery({ queryKey: ['/documents/', id], queryFn: () => api.get(`/documents/${id}/`).then((r) => r.data) })
  const d = q.data

  if (q.isLoading) return <div className="animate-pulse space-y-3"><div className="h-8 w-56 rounded bg-slate-200" /><div className="h-56 rounded-xl bg-slate-200" /></div>
  if (q.error?.response?.status === 404) return <NotFound />
  if (q.isError) return <div className="text-danger">{errorMessage(q.error)}</div>

  const current = d.status === 'ACTIVE'
  const canChange = can('fleet.change_vehicledocument')
  const canRenew = canChange && can('fleet.add_vehicledocument') && current

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/documents" className="hover:underline">Documents</Link> / <span aria-current="page">{d.plate_number} · {d.document_type_display}</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-ink">{d.document_type_display}</h1>
            <DocBadge doc={d} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <Link to={`/vehicles/${d.vehicle}?tab=documents`} className="font-semibold tracking-wide text-brand hover:underline">{d.plate_number}</Link>
            {' '}· {d.vehicle_label} · {d.office_code}
          </p>
        </div>
        {canChange && current && <Button variant="secondary" onClick={() => setDialog('edit')}><Pencil size={16} /> Edit</Button>}
        {canChange && current && <Button variant="secondary" className="text-danger" onClick={() => setDialog('cancel')}><XCircle size={16} /> Cancel entry</Button>}
        {canRenew && <Button onClick={() => setDialog('renew')}><RefreshCw size={16} /> Renew</Button>}
      </div>

      {!current && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {d.status === 'SUPERSEDED' ? 'This is an earlier version kept for the record. ' : 'This entry was cancelled and no longer alerts. '}
          {d.history.find((h) => h.status === 'ACTIVE') && (
            <Link to={`/documents/${d.history.find((h) => h.status === 'ACTIVE').id}`} className="font-medium text-brand hover:underline">Open the current one</Link>
          )}
        </div>
      )}

      {current && d.expiry?.band !== 'NONE' && (
        <div className={`mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 ${urgent(d) ? 'border-red-200 bg-red-50 text-danger' : soon(d) ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-green-200 bg-green-50 text-green-800'}`}>
          {d.expiry.band === 'EXPIRED' ? <CalendarX2 size={22} aria-hidden="true" /> : <CalendarClock size={22} aria-hidden="true" />}
          <div className="mr-auto">
            <div className="font-semibold">{daysText(d.expiry)}</div>
            <div className="text-sm opacity-90">
              {d.expiry.band === 'EXPIRED' ? 'Renew it as soon as possible; the vehicle should not be used without it.'
                : d.expiry.band === 'VALID' ? `Valid until ${formatDate(d.expiry_date)}. Alerts start 60 days before.`
                  : `Expires on ${formatDate(d.expiry_date)}. Start the renewal now.`}
            </div>
          </div>
          {canRenew && (urgent(d) || soon(d)) && <Button onClick={() => setDialog('renew')}><RefreshCw size={16} /> Renew now</Button>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-ink">Details</h2>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <Fact label="Reference number" value={d.reference_number || '—'} mono />
              <Fact label="Issue date" value={formatDate(d.issue_date)} />
              <Fact label="Expiry date" value={d.expiry_date ? formatDate(d.expiry_date) : 'No expiry'} />
              <Fact label="Recorded" value={formatDateTime(d.created_at)} />
              <Fact label="Last updated" value={formatDateTime(d.updated_at)} />
              <Fact label="Status" value={d.status_display} />
            </dl>
            {d.remarks && <div className="mt-4 border-t border-slate-100 pt-3 text-sm whitespace-pre-line text-slate-700"><span className="mb-1 block text-xs text-slate-500">Remarks</span>{d.remarks}</div>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="hist-title">
            <h2 id="hist-title" className="mb-1 font-semibold text-ink">Renewal history</h2>
            <p className="mb-4 text-sm text-slate-500">Every {d.document_type_display} recorded for {d.plate_number}, newest first.</p>
            <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6">
              {d.history.map((h) => (
                <li key={h.id} className="relative">
                  <span className={`absolute top-1 -left-[31px] h-3.5 w-3.5 rounded-full ring-4 ring-white ${h.status === 'ACTIVE' ? 'bg-brand' : 'bg-slate-300'}`} aria-hidden="true" />
                  <div className={`rounded-lg border px-4 py-3 ${String(h.id) === String(id) ? 'border-brand/40 bg-brand-light/40' : 'border-slate-200'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {String(h.id) === String(id)
                        ? <span className="font-medium">{h.reference_number || 'No reference'}</span>
                        : <Link to={`/documents/${h.id}`} className="font-medium text-brand hover:underline">{h.reference_number || 'No reference'}</Link>}
                      <DocBadge doc={h} />
                      {String(h.id) === String(id) && <span className="text-xs text-slate-500">(this one)</span>}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {h.issue_date ? `Issued ${formatDate(h.issue_date)}` : 'Issue date not recorded'} · {h.expiry_date ? `expires ${formatDate(h.expiry_date)}` : 'no expiry'}
                    </div>
                    {h.file && <a href={h.file} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Paperclip size={12} aria-hidden="true" /> Scanned copy</a>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-ink">Scanned copy</h2>
            {d.file ? (
              <a href={d.file} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand hover:bg-brand-light/30">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand"><FileText size={20} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.document_type_display}</span>
                  <span className="block text-xs text-slate-500">Open in a new tab</span>
                </span>
                <ExternalLink size={16} className="text-slate-400" aria-hidden="true" />
              </a>
            ) : (
              <p className="text-sm text-slate-500">No scan uploaded.{canChange && current && ' Use Edit to attach the PDF or photo.'}</p>
            )}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-ink">Vehicle</h2>
            <Link to={`/vehicles/${d.vehicle}?tab=documents`} className="flex items-center gap-3 hover:opacity-90">
              <VehiclePhoto vehicle={{ photo_url: d.vehicle_photo_url, plate_number: d.plate_number, make: '', model: d.vehicle_label }} className="w-20 shrink-0 border border-slate-200" />
              <span><span className="block font-semibold tracking-wide text-brand">{d.plate_number}</span><span className="block text-xs text-slate-500">{d.vehicle_label} · all documents</span></span>
            </Link>
          </section>
        </aside>
      </div>

      <Modal open={dialog === 'edit' || dialog === 'renew'} onClose={() => setDialog(null)} title={dialog === 'renew' ? `Renew ${d.document_type_display}` : 'Edit document'} wide>
        {(dialog === 'edit' || dialog === 'renew') && (
          <DocumentForm doc={d} renew={dialog === 'renew'} onClose={() => setDialog(null)}
            onSaved={(saved) => { if (dialog === 'renew') navigate(`/documents/${saved.id}`) }} />
        )}
      </Modal>
      <Modal open={dialog === 'cancel'} onClose={() => setDialog(null)} title="Cancel this entry">
        {dialog === 'cancel' && <CancelForm doc={d} onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}

function Fact({ label, value, mono }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`mt-0.5 font-medium ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}

function CancelForm({ doc, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const cancel = useMutation({
    mutationFn: () => api.post(`/documents/${doc.id}/cancel/`, { reason }),
    onSuccess: () => { invalidatePrefix(qc, '/documents/'); toast('Entry cancelled.'); onClose() },
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); cancel.mutate() }} className="space-y-4">
      <p className="text-sm text-slate-600">
        Use this for a wrong entry (wrong vehicle, wrong type). It stays on record but stops alerting. To record a new
        registration or policy, use <strong>Renew</strong> instead.
      </p>
      <Field label="Reason *" htmlFor="cancel-reason" error={cancel.isError ? errorMessage(cancel.error) : undefined}>
        <textarea id="cancel-reason" rows={2} required className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Entered on the wrong vehicle" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button type="submit" variant="danger" disabled={!reason.trim() || cancel.isPending}>Cancel entry</Button>
      </div>
    </form>
  )
}
