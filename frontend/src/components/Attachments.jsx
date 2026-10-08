import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Paperclip, Trash2, Upload } from 'lucide-react'
import { api, errorMessage } from '../api'
import { Button, ConfirmDialog, formatDateTime, inputBase } from './ui'
import { useToast } from './toast'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'
const MAX_MB = 10 // matches ATTACHMENT_MAX_BYTES default; the server enforces the real limit

export const formatBytes = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`)

/**
 * Supporting files for a record served by AttachmentsMixin.
 * basePath: '/drivers/5' or '/trips/12'. canChange: whether to show upload/remove.
 */
export default function Attachments({ basePath, canChange, title = 'Attachments' }) {
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [description, setDescription] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(null)
  const key = [`${basePath}/`, 'attachments']
  const list = useQuery({ queryKey: key, queryFn: () => api.get(`${basePath}/attachments/`).then((r) => r.data) })

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData()
      body.append('file', file)
      body.append('description', description)
      return api.post(`${basePath}/attachments/`, body, {
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key })
      toast('Attachment uploaded.')
      setFile(null); setDescription(''); setProgress(0)
    },
    onError: (err) => { setError(errorMessage(err)); setProgress(0) },
  })
  const remove = useMutation({
    mutationFn: (a) => api.delete(`${basePath}/attachments/${a.id}/`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast('Attachment removed.'); setRemoving(null) },
    onError: (err) => { toast(errorMessage(err), 'error'); setRemoving(null) },
  })

  const pick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError('')
    if (!/\.(pdf|jpe?g|png|webp)$/i.test(f.name)) return setError('Choose a PDF, JPEG, PNG or WebP file.')
    if (f.size > MAX_MB * 1024 * 1024) return setError(`File must be ${MAX_MB} MB or smaller.`)
    setFile(f)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand"><Paperclip size={16} aria-hidden="true" /> {title}</h2>

      {list.isLoading && <div className="h-10 animate-pulse rounded bg-slate-200" />}
      {list.isError && <p className="text-sm text-danger">{errorMessage(list.error)}</p>}
      {list.data?.length === 0 && <p className="text-sm text-slate-500">No attachments yet.</p>}
      <ul className="divide-y divide-slate-100">
        {list.data?.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
            <FileText size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-brand hover:underline">{a.original_name}</a>
              <span className="text-xs text-slate-500">
                {[a.description, formatBytes(a.size), formatDateTime(a.uploaded_at), a.uploaded_by_name].filter(Boolean).join(' · ')}
              </span>
            </div>
            {canChange && (
              <Button variant="ghost" className="text-danger" onClick={() => setRemoving(a)} aria-label={`Remove ${a.original_name}`}><Trash2 size={16} /></Button>
            )}
          </li>
        ))}
      </ul>

      {canChange && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={pick} aria-label="Choose attachment" />
          {file ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{file.name} ({formatBytes(file.size)})</span>
              <input className={`${inputBase} w-64`} placeholder="Description (optional)" aria-label="Attachment description"
                maxLength={255} value={description} onChange={(e) => setDescription(e.target.value)} />
              <Button onClick={() => upload.mutate()} disabled={upload.isPending}>
                <Upload size={16} /> {upload.isPending ? `Uploading ${progress}%` : 'Upload'}
              </Button>
              <Button variant="secondary" onClick={() => setFile(null)} disabled={upload.isPending}>Cancel</Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => input.current.click()}><Paperclip size={16} /> Add attachment</Button>
          )}
          {upload.isPending && (
            <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
              <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          <p className="mt-2 text-xs text-slate-500">PDF, JPEG, PNG or WebP, up to {MAX_MB} MB.</p>
        </div>
      )}

      <ConfirmDialog open={!!removing} title="Remove attachment"
        message={`"${removing?.original_name}" will be deleted. This is recorded in the audit trail.`}
        confirmLabel="Remove" danger busy={remove.isPending} onConfirm={() => remove.mutate(removing)} onClose={() => setRemoving(null)} />
    </section>
  )
}
