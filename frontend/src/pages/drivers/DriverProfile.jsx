import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Paperclip, Pencil, Trash2, Upload } from 'lucide-react'
import { api, errorMessage, useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { Badge, Button, ConfirmDialog, formatDateTime, inputBase, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { NotFound } from '../Errors'
import { formatDate } from '../vehicles/common'
import DriverForm from './DriverForm'
import { formatBytes, LicenseBadge } from './common'

export default function DriverProfile() {
  const { id } = useParams()
  const can = useCan()
  const [editing, setEditing] = useState(false)
  const query = useQuery({
    queryKey: ['/drivers/', id],
    queryFn: () => api.get(`/drivers/${id}/`).then((r) => r.data),
  })
  const d = query.data

  if (query.isLoading) return <div className="animate-pulse space-y-3"><div className="h-8 w-56 rounded bg-slate-200" /><div className="h-48 rounded-lg bg-slate-200" /></div>
  if (query.error?.response?.status === 404) return <NotFound />
  if (query.isError) return <div className="text-danger">{errorMessage(query.error)}</div>

  const details = [
    ['Employee number', d.employee_number ?? '—'],
    ['Office', d.office_name],
    ['Contact number', d.contact_number || '—'],
    ['License number', d.license_number],
    ['License type', d.license_type_display],
    ['Restrictions', d.license_restrictions || '—'],
    ['Issued', formatDate(d.license_issue_date)],
    ['Expires', formatDate(d.license_expiry_date)],
  ]

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/drivers" className="hover:underline">Drivers</Link> / <span aria-current="page">{d.full_name}</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-brand">{d.full_name}</h1>
            <Badge tone={d.is_active ? 'green' : 'gray'}>{d.is_active ? 'Active' : 'Inactive'}</Badge>
            <LicenseBadge status={d.license_status} />
          </div>
        </div>
        {can('fleet.change_driver') && (
          <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} /> Edit</Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-brand">Driver details</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {details.map(([l, v]) => (
              <div key={l}><dt className="text-slate-500">{l}</dt><dd className="font-medium">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-400">Last updated {formatDateTime(d.updated_at)}</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-brand">Current vehicle</h2>
          {d.current_vehicles.length ? (
            <ul className="space-y-1 text-sm">
              {d.current_vehicles.map((v) => (
                <li key={v.assignment_id}><Link to={`/vehicles/${v.vehicle_id}`} className="font-medium text-brand hover:underline">{v.plate_number}</Link></li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Not assigned to a vehicle.</p>}
        </section>
      </div>

      <Attachments driver={d} />
      <History driverId={id} />

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${d.full_name}`} wide>
        {editing && <DriverForm driver={d} onClose={() => setEditing(false)} />}
      </Modal>
    </div>
  )
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'
const MAX_MB = 10 // matches ATTACHMENT_MAX_BYTES default; the server enforces the real limit

function Attachments({ driver }) {
  const can = useCan()
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [description, setDescription] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(null)
  const key = ['/drivers/', String(driver.id), 'attachments']
  const list = useQuery({ queryKey: key, queryFn: () => api.get(`/drivers/${driver.id}/attachments/`).then((r) => r.data) })
  const canChange = can('fleet.change_driver')

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData()
      body.append('file', file)
      body.append('description', description)
      return api.post(`/drivers/${driver.id}/attachments/`, body, {
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
    mutationFn: (a) => api.delete(`/drivers/${driver.id}/attachments/${a.id}/`),
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
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand"><Paperclip size={16} aria-hidden="true" /> License scans and attachments</h2>

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

function History({ driverId }) {
  const [page, setPage] = useState(1)
  const query = useList(`/drivers/${driverId}/assignments/`, { page })
  const columns = [
    { key: 'plate', label: 'Vehicle', render: (a) => <Link to={`/vehicles/${a.vehicle}`} className="font-semibold text-brand hover:underline">{a.plate_number}</Link> },
    { key: 'office', label: 'Office', render: (a) => a.office_code },
    { key: 'accountable_person', label: 'Accountable person' },
    { key: 'start_date', label: 'From', render: (a) => formatDate(a.start_date) },
    { key: 'end_date', label: 'To', render: (a) => a.end_date ? formatDate(a.end_date) : '—' },
    { key: 'status', label: 'Status', render: (a) => <Badge tone={a.is_current ? 'green' : 'gray'}>{a.is_current ? 'Current' : 'Ended'}</Badge> },
  ]
  return (
    <section className="mt-4">
      <h2 className="mb-2 text-sm font-semibold text-brand">Assignment history</h2>
      <DataTable columns={columns} query={query} page={page} onPage={setPage} empty="This driver has not been assigned to a vehicle yet." />
    </section>
  )
}
