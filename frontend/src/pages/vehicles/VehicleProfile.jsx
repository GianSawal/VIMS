import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, ArchiveRestore, Building2, CalendarDays, CircleDot, Fuel, Gauge, History, IdCard, ImagePlus, Pencil, Trash2, Upload,
} from 'lucide-react'
import { api, errorMessage } from '../../api'
import { useCan } from '../../auth'
import { Button, ConfirmDialog, formatDateTime } from '../../components/ui'
import { useToast } from '../../components/toast'
import { NotFound } from '../Errors'
import AssignmentsTab from './AssignmentsTab'
import TripsTab from './TripsTab'
import { duration, formatDate, formatKm, formatPeso, fuelLabel, StatusBadge, VehiclePhoto } from './common'

// Tabs fill in as their phases land; `phase` marks ones not built yet.
const TABS = [
  ['overview', 'Overview'],
  ['assignments', 'Assignments'],
  ['trips', 'Trips'],
  ['fuel', 'Fuel', 7],
  ['maintenance', 'Maintenance', 8],
  ['documents', 'Documents', 9],
  ['rfid', 'RFID / Toll', 10],
  ['activity', 'Activity', 14],
]

export default function VehicleProfile() {
  const { id } = useParams()
  const can = useCan()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const [confirm, setConfirm] = useState(false)

  const query = useQuery({
    queryKey: ['/vehicles/', id],
    queryFn: () => api.get(`/vehicles/${id}/`).then((r) => r.data),
  })
  const v = query.data

  const archive = useMutation({
    mutationFn: () => api.post(`/vehicles/${id}/${v.is_archived ? 'reactivate' : 'archive'}/`),
    onSuccess: ({ data }) => {
      qc.setQueryData(['/vehicles/', id], data)
      qc.invalidateQueries({ queryKey: ['/vehicles/'] })
      toast(data.is_archived ? 'Vehicle archived.' : 'Vehicle reactivated.')
      setConfirm(false)
    },
    onError: (err) => { toast(errorMessage(err), 'error'); setConfirm(false) },
  })

  if (query.isLoading) return <ProfileSkeleton />
  if (query.error?.response?.status === 404) return <NotFound />
  if (query.isError) return <div className="text-danger">{errorMessage(query.error)}</div>

  const canChange = can('fleet.change_vehicle')

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/vehicles" className="hover:underline">Vehicles</Link> / <span aria-current="page">{v.plate_number}</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-brand">{v.plate_number}</h1>
            <StatusBadge vehicle={v} />
          </div>
          <p className="text-slate-600">{v.make} {v.model} {v.variant} {v.year_model && `· ${v.year_model}`}</p>
        </div>
        {canChange && !v.is_archived && (
          <Button variant="secondary" onClick={() => navigate(`/vehicles/${id}/edit`)}><Pencil size={16} /> Edit</Button>
        )}
        {canChange && (
          <Button variant={v.is_archived ? 'secondary' : 'danger'} onClick={() => setConfirm(true)}>
            {v.is_archived ? <><ArchiveRestore size={16} /> Reactivate</> : <><Archive size={16} /> Archive</>}
          </Button>
        )}
      </div>

      {v.is_archived && (
        <div className="mb-4 rounded-md border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-700">
          Archived on {formatDateTime(v.archived_at)}. Records are read-only but stay in history and reports.
        </div>
      )}

      <div role="tablist" aria-label="Vehicle sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key}
            onClick={() => setParams(key === 'overview' ? {} : { tab: key }, { replace: true })}
            className={`border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${tab === key ? 'border-accent text-brand' : 'border-transparent text-slate-500 hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'overview' ? <Overview v={v} onHistory={() => setParams({ tab: 'assignments' }, { replace: true })} /> : tab === 'assignments' ? <AssignmentsTab v={v} /> : tab === 'trips' ? <TripsTab v={v} /> : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
            {TABS.find(([k]) => k === tab)?.[1] ?? 'This section'} history arrives in Phase {TABS.find(([k]) => k === tab)?.[2]}.
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        title={v.is_archived ? 'Reactivate vehicle' : 'Archive vehicle'}
        message={v.is_archived
          ? `${v.plate_number} will appear in the active vehicle list again.`
          : `${v.plate_number} will be hidden from the active list and become read-only. Its history is kept for reports.`}
        confirmLabel={v.is_archived ? 'Reactivate' : 'Archive'}
        danger={!v.is_archived}
        busy={archive.isPending}
        onConfirm={() => archive.mutate()}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}

function Overview({ v, onHistory }) {
  const a = v.current_assignment
  const age = v.acquisition_date ? duration(v.acquisition_date) : '—'
  const sections = [
    ['Identification', [
      ['Plate number', v.plate_number],
      ['Property number', v.property_number],
      ['Engine number', v.engine_number, true],
      ['Chassis number', v.chassis_number, true],
    ]],
    ['Specifications', [
      ['Make', v.make],
      ['Model', [v.model, v.variant].filter(Boolean).join(' ')],
      ['Year model', v.year_model],
      ['Vehicle type', v.vehicle_type_display],
      ['Fuel type', fuelLabel[v.fuel_type]],
      ['Color', v.color],
    ]],
    ['Acquisition', [
      ['Date acquired', formatDate(v.acquisition_date)],
      ['Cost', formatPeso(v.acquisition_cost)],
      ['In service for', age],
    ]],
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <PhotoPanel v={v} />
      <div className="space-y-4 lg:col-span-2">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={Gauge} label="Odometer" value={formatKm(v.current_odometer)} />
          <Stat icon={Building2} label="Owning office" value={v.office_code} hint={v.office_name} />
          <Stat icon={CircleDot} label="Status" value={<StatusBadge vehicle={v} />} />
          <Stat icon={Fuel} label="Fuel type" value={fuelLabel[v.fuel_type]} />
        </div>

        <Card title="Current assignment" action={
          <Button variant="ghost" onClick={onHistory}><History size={16} /> View history</Button>
        }>
          {a ? (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white" aria-hidden="true">
                  {initials(a.accountable_person)}
                </span>
                <div>
                  <div className="text-xs text-slate-500">Accountable person</div>
                  <div className="font-semibold">{a.accountable_person}</div>
                  <div className="text-sm text-slate-500">{a.office}</div>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-xs text-slate-500"><IdCard size={14} aria-hidden="true" /> Driver</div>
                <div className="font-medium">
                  {a.driver_id ? <Link to={`/drivers/${a.driver_id}`} className="text-brand hover:underline">{a.driver}</Link> : (a.driver ?? '—')}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-xs text-slate-500"><CalendarDays size={14} aria-hidden="true" /> Assigned since</div>
                <div className="font-medium">{formatDate(a.start_date)}</div>
                <div className="text-sm text-slate-500">{duration(a.start_date)}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
              Not currently assigned. Open the history to assign this vehicle.
            </div>
          )}
        </Card>

        <Card title="Vehicle details">
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
            {sections.map(([title, rows]) => (
              <section key={title} aria-label={title}>
                <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{title}</h3>
                <dl>
                  {rows.map(([label, value, mono]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className={`text-right font-medium break-all ${mono ? 'font-mono text-[13px]' : ''}`}>{value || <span className="text-slate-400">—</span>}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          {v.remarks && (
            <div className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm">
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Remarks</div>
              <p className="whitespace-pre-line">{v.remarks}</p>
            </div>
          )}
          <p className="mt-4 text-xs text-slate-400">Added {formatDateTime(v.created_at)} · Last updated {formatDateTime(v.updated_at)}</p>
        </Card>
      </div>
    </div>
  )
}

// "Atty. SARAH BUENA S. MIRASOL" -> "SM": skips titles/initials that end with a period.
const initials = (name) => name.split(/\s+/).filter((w) => w && !w.endsWith('.')).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 5 // matches VEHICLE_PHOTO_MAX_BYTES default; the server enforces the real limit

function PhotoPanel({ v }) {
  const can = useCan()
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const allowed = can('fleet.manage_vehicle_photo') && can('fleet.change_vehicle') && !v.is_archived

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  const done = (data, msg) => {
    qc.setQueryData(['/vehicles/', String(v.id)], data)
    qc.invalidateQueries({ queryKey: ['/vehicles/'] })
    toast(msg)
    setFile(null); setPreview(null); setProgress(0)
  }

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData()
      body.append('photo', file)
      return api.post(`/vehicles/${v.id}/photo/`, body, {
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
      })
    },
    onSuccess: ({ data }) => done(data, v.photo_url ? 'Photo replaced.' : 'Photo uploaded.'),
    onError: (err) => { setError(errorMessage(err)); setProgress(0) },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/vehicles/${v.id}/photo/`),
    onSuccess: ({ data }) => { done(data, 'Photo removed.'); setConfirmRemove(false) },
    onError: (err) => { toast(errorMessage(err), 'error'); setConfirmRemove(false) },
  })

  const pick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError('')
    if (!ACCEPT.includes(f.type)) return setError('Choose a JPEG, PNG or WebP image.')
    if (f.size > MAX_MB * 1024 * 1024) return setError(`Photo must be ${MAX_MB} MB or smaller.`)
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {preview
        ? <div className="aspect-[4/3] overflow-hidden rounded-md bg-white ring-2 ring-gold"><img src={preview} alt="Preview of the new photo" className="h-full w-full object-contain" /></div>
        : <VehiclePhoto vehicle={v} />}

      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {upload.isPending && (
        <div className="mt-3 h-2 overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
          <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {allowed && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input ref={input} type="file" accept={ACCEPT.join(',')} className="hidden" onChange={pick} aria-label="Choose vehicle photo" />
          {file ? (
            <>
              <Button onClick={() => upload.mutate()} disabled={upload.isPending}><Upload size={16} /> {upload.isPending ? `Uploading ${progress}%` : 'Save photo'}</Button>
              <Button variant="secondary" onClick={() => { setFile(null); setPreview(null) }} disabled={upload.isPending}>Cancel</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => input.current.click()}>
                <ImagePlus size={16} /> {v.photo_url ? 'Change photo' : 'Upload photo'}
              </Button>
              {v.photo_url && <Button variant="ghost" className="text-danger" onClick={() => setConfirmRemove(true)}><Trash2 size={16} /> Remove</Button>}
            </>
          )}
        </div>
      )}
      {allowed && !file && <p className="mt-2 text-xs text-slate-500">JPEG, PNG or WebP, up to {MAX_MB} MB.</p>}

      <ConfirmDialog open={confirmRemove} title="Remove photo" message="The vehicle photo will be deleted. This is recorded in the audit trail."
        confirmLabel="Remove" danger busy={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setConfirmRemove(false)} />
    </div>
  )
}

function Card({ title, action, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-brand">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand"><Icon size={18} aria-hidden="true" /></span>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-0.5 text-lg leading-tight font-semibold">{value}</div>
        {hint && <div className="truncate text-xs text-slate-500" title={hint}>{hint}</div>}
      </div>
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-slate-200" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="aspect-[4/3] rounded-lg bg-slate-200" />
        <div className="h-64 rounded-lg bg-slate-200 lg:col-span-2" />
      </div>
    </div>
  )
}
