import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, RefreshCw } from 'lucide-react'
import { api, applyFieldErrors, invalidatePrefix, useList } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import { todayISO } from '../drivers/common'
import { formatDate } from '../vehicles/common'
import { DOC_TYPES, needsExpiry } from './common'

const FIELDS = ['vehicle', 'document_type', 'reference_number', 'issue_date', 'expiry_date', 'file', 'remarks']

/** Add (`vehicle` locks the vehicle), edit (`doc`) or renew (`doc` + renew) a document. Sent as multipart for the scan. */
export default function DocumentForm({ doc, vehicle, renew = false, onClose, onSaved }) {
  const mode = renew ? 'renew' : doc ? 'edit' : 'create'
  const qc = useQueryClient()
  const toast = useToast()
  const vehicles = useList('/vehicles/', { page_size: 500 })
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    defaultValues: mode === 'edit'
      ? { reference_number: doc.reference_number, issue_date: doc.issue_date ?? '', expiry_date: doc.expiry_date ?? '', remarks: doc.remarks }
      : { vehicle: vehicle ? String(vehicle.id) : '', document_type: vehicle ? '' : 'LTO_REGISTRATION', reference_number: '',
          issue_date: mode === 'renew' ? todayISO() : '', expiry_date: '', remarks: '' },
  })
  const type = doc?.document_type ?? watch('document_type')
  const expiryRequired = needsExpiry(type)

  const save = useMutation({
    mutationFn: (body) => (mode === 'create' ? api.post('/documents/', body)
      : mode === 'renew' ? api.post(`/documents/${doc.id}/renew/`, body)
        : api.patch(`/documents/${doc.id}/`, body)),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/documents/')
      toast(mode === 'renew' ? `${data.document_type_display} renewed. The previous one is kept in its history.`
        : mode === 'create' ? `${data.document_type_display} added.` : 'Document updated.')
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => {
    const body = new FormData()
    if (mode === 'create') { body.append('vehicle', v.vehicle); body.append('document_type', v.document_type) }
    for (const k of ['reference_number', 'issue_date', 'expiry_date', 'remarks']) body.append(k, v[k] ?? '') // '' clears a date
    if (v.file?.[0]) body.append('file', v.file[0])
    save.mutate(body)
  }

  const text = (name, label, { hint, ...props } = {}) => (
    <Field label={label} htmlFor={`doc-${name}`} error={errors[name]?.message} hint={hint}>
      <input id={`doc-${name}`} className={inputClass} {...register(name)} {...props} />
    </Field>
  )

  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

      {doc ? (
        <div className="flex items-center gap-3 rounded-lg bg-brand-light/50 px-3 py-2 text-sm">
          {renew ? <RefreshCw size={18} className="shrink-0 text-brand" aria-hidden="true" /> : <FileText size={18} className="shrink-0 text-brand" aria-hidden="true" />}
          <div>
            <div className="font-medium text-ink">{doc.document_type_display} · {doc.plate_number}</div>
            {renew && <div className="text-xs text-slate-600">Current: {doc.reference_number || 'no reference'}, expires {formatDate(doc.expiry_date)}. It moves to history when you save.</div>}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {vehicle ? (
            <div>
              <span className="mb-1 block text-sm font-medium">Vehicle</span>
              <input type="hidden" {...register('vehicle')} />
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{vehicle.plate_number} · {vehicle.make} {vehicle.model}</div>
            </div>
          ) : (
            <Field label="Vehicle *" htmlFor="doc-vehicle" error={errors.vehicle?.message}>
              <select id="doc-vehicle" className={inputClass} {...register('vehicle', { required: 'Select a vehicle' })}>
                <option value="">Select a vehicle…</option>
                {vehicles.data?.results.map((v) => <option key={v.id} value={v.id}>{v.plate_number} · {v.make} {v.model}</option>)}
              </select>
            </Field>
          )}
          <Field label="Document type *" htmlFor="doc-document_type" error={errors.document_type?.message}>
            <select id="doc-document_type" className={inputClass} {...register('document_type', { required: 'Choose the document type' })}>
              <option value="">Select a type…</option>
              {DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {text('reference_number', renew ? 'New reference / OR number' : 'Reference number', {
            className: `${inputClass} uppercase placeholder:normal-case`, placeholder: 'e.g. OR no., policy no., MV file no.' })}
        </div>
        {text('issue_date', 'Issue date', { type: 'date', max: todayISO() })}
        {text('expiry_date', `Expiry date${expiryRequired ? ' *' : ''}`, {
          type: 'date', hint: expiryRequired ? 'Alerts start 60 days before (then 30, 15 and 7).' : 'Leave blank if it does not expire.',
        })}
        <div className="sm:col-span-2">
          <Field label={doc && !renew ? 'Replace scanned copy' : 'Scanned copy'} htmlFor="doc-file" error={errors.file?.message}
            hint={doc?.file_name && !renew ? `Current file: ${doc.file_name}. Choose a file only to replace it.` : 'PDF, JPEG, PNG or WebP, up to 10 MB.'}>
            <input id="doc-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" {...register('file')}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-light file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand hover:file:bg-brand/15" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Remarks" htmlFor="doc-remarks" error={errors.remarks?.message}>
            <textarea id="doc-remarks" rows={2} className={inputClass} placeholder={renew ? 'e.g. Renewed at LTO Tarlac, paid ₱1,850' : ''} {...register('remarks')} />
          </Field>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : mode === 'renew' ? 'Save renewal' : mode === 'create' ? 'Add document' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
