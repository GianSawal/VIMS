import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarCheck, CheckCircle2, Gauge, Wrench, XCircle } from 'lucide-react'
import { api, applyFieldErrors, invalidatePrefix } from '../../api'
import { Button, Field, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'
import { formatDate, VehiclePhoto } from '../vehicles/common'
import { km } from './common'

/** Pre-trip check: same keys as CHECKLIST_ITEMS in backend operations/trips.py. */
export const CHECKLIST = [['tires', 'Tires'], ['brakes', 'Brakes'], ['lights', 'Lights and signals'], ['oil', 'Engine oil'],
  ['coolant', 'Coolant / water'], ['fuel', 'Enough fuel'], ['documents', 'OR/CR and trip ticket on board']]

const todayISO = () => new Date().toLocaleDateString('en-CA')

/** Checkboxes + notes. Controlled: `value` is {item: bool, notes}. */
export function ChecklistFields({ value, onChange }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Pre-trip check <span className="font-normal text-slate-500">(tick what is OK)</span></legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {CHECKLIST.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm has-checked:border-green-300 has-checked:bg-green-50">
            <input type="checkbox" checked={!!value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} /> {label}
          </label>
        ))}
      </div>
      <textarea aria-label="Check notes" rows={2} maxLength={500} placeholder="Anything to note (optional)" className={inputClass}
        value={value.notes ?? ''} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
    </fieldset>
  )
}

/** The pre-trip check as recorded, for the trip page. */
export function ChecklistView({ checklist }) {
  if (!checklist || !Object.keys(checklist).length) return null
  return (
    <section aria-labelledby="check-title" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 id="check-title" className="mb-2 font-semibold text-ink">Pre-trip check</h2>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {CHECKLIST.map(([k, label]) => (
          <li key={k} className="flex items-center gap-2">
            {checklist[k] ? <CheckCircle2 size={16} className="text-green-700" aria-hidden="true" /> : <XCircle size={16} className="text-danger" aria-hidden="true" />}
            {label}<span className="sr-only">{checklist[k] ? ': OK' : ': not OK or not checked'}</span>
          </li>
        ))}
      </ul>
      {checklist.notes && <p className="mt-2 text-sm text-slate-600">Notes: {checklist.notes}</p>}
    </section>
  )
}

function useDriverPost(path, message, onClose) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body) => api.post(path, body).then((r) => r.data),
    onSuccess: () => {
      invalidatePrefix(qc, '/trips/', '/driver/', '/vehicles/', '/fuel', '/maintenance')
      toast(message)
      onClose()
    },
  })
}

const errorsFrom = (err, fields, setErrors) => {
  const rest = applyFieldErrors(err, (k, v) => setErrors((x) => ({ ...x, [k]: v.message })), fields)
  return rest
}

/** Start a scheduled trip on its day: odometer now, plus the pre-trip check. */
export function StartTripForm({ trip, onClose }) {
  const [odo, setOdo] = useState('')
  const [check, setCheck] = useState({})
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const start = useDriverPost(`/trips/${trip.id}/dispatch/`, 'Trip started. Drive safely.', onClose)
  const submit = (e) => {
    e.preventDefault()
    const n = Number(String(odo).replace(/[,\s]/g, ''))
    if (!odo || !Number.isInteger(n) || n < 0) return setErrors({ odometer_start: 'Enter the odometer reading in km' })
    start.mutate({ odometer_start: n, checklist: check }, { onError: (err) => setError(errorsFrom(err, ['odometer_start', 'checklist'], setErrors)) })
  }
  return (
    <form noValidate className="space-y-4" onSubmit={submit}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <p className="text-sm text-slate-600">{trip.plate_number} to {trip.destination}. The office is told the trip has started.</p>
      <Field label="Odometer now (km) *" htmlFor="start-odo" error={errors.odometer_start} hint="Read it from the dashboard.">
        <input id="start-odo" inputMode="numeric" autoFocus className={inputClass} value={odo} onChange={(e) => { setOdo(e.target.value); setErrors({}) }} />
      </Field>
      <ChecklistFields value={check} onChange={setCheck} />
      {errors.checklist && <p className="text-sm text-danger">{errors.checklist}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button type="submit" disabled={start.isPending}>{start.isPending ? 'Starting…' : 'Start trip'}</Button>
      </div>
    </form>
  )
}

const FUEL_FIELDS = ['date', 'odometer', 'liters', 'unit_price', 'total_amount', 'supplier', 'receipt_number', 'receipt']

/** A fill-up during the trip; vehicle and driver come from the trip. Optional receipt photo. */
export function FuelTripForm({ trip, onClose }) {
  const [v, setV] = useState({ date: todayISO(), odometer: '', liters: '', unit_price: '', total_amount: '', supplier: '', receipt_number: '', is_full_tank: true })
  const [receipt, setReceipt] = useState(null)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const save = useDriverPost(`/trips/${trip.id}/fuel/`, 'Fuel recorded.', onClose)
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setErrors({ ...errors, [k]: undefined }) }
  const submit = (e) => {
    e.preventDefault()
    const need = Object.fromEntries(['odometer', 'liters', 'unit_price'].filter((k) => !String(v[k]).trim()).map((k) => [k, 'Required']))
    if (Object.keys(need).length) return setErrors(need)
    const body = new FormData()
    Object.entries(v).forEach(([k, x]) => { if (x !== '') body.append(k, String(x).replace(/,/g, '')) })
    if (receipt) body.append('receipt', receipt)
    save.mutate(body, { onError: (err) => setError(errorsFrom(err, FUEL_FIELDS, setErrors)) })
  }
  const input = (k, label, props = {}) => (
    <Field label={label} htmlFor={`fuel-${k}`} error={errors[k]}>
      <input id={`fuel-${k}`} className={inputClass} value={v[k]} onChange={set(k)} {...props} />
    </Field>
  )
  return (
    <form noValidate className="space-y-4" onSubmit={submit}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <p className="text-sm text-slate-600">{trip.plate_number}, trip {trip.ticket_number}.</p>
      <div className="grid grid-cols-2 gap-3">
        {input('date', 'Date *', { type: 'date', max: todayISO() })}
        {input('odometer', 'Odometer (km) *', { inputMode: 'numeric' })}
        {input('liters', 'Liters *', { inputMode: 'decimal' })}
        {input('unit_price', 'Price per liter *', { inputMode: 'decimal' })}
        {input('total_amount', 'Total on receipt', { inputMode: 'decimal', placeholder: 'Liters × price' })}
        {input('receipt_number', 'Receipt no.')}
      </div>
      {input('supplier', 'Gas station')}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.is_full_tank} onChange={set('is_full_tank')} /> Filled the tank full</label>
      <Field label="Receipt photo" htmlFor="fuel-receipt" error={errors.receipt} hint="JPEG, PNG, WebP or PDF.">
        <input id="fuel-receipt" type="file" accept="image/*,application/pdf" capture="environment" className="block w-full text-sm"
          onChange={(e) => setReceipt(e.target.files[0] ?? null)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save fuel'}</Button>
      </div>
    </form>
  )
}

function ReportProblemForm({ vehicle, onClose }) {
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState(null)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const send = useDriverPost('/driver/report-problem/', 'Problem reported. The office has been told.', onClose)
  const submit = (e) => {
    e.preventDefault()
    if (!text.trim()) return setErrors({ description: 'Describe the problem' })
    const body = new FormData()
    body.append('vehicle', vehicle.id)
    body.append('description', text)
    if (photo) body.append('photo', photo)
    send.mutate(body, { onError: (err) => setError(errorsFrom(err, ['vehicle', 'description', 'photo'], setErrors)) })
  }
  return (
    <form noValidate className="space-y-4" onSubmit={submit}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
      <Field label="What is wrong? *" htmlFor="problem-text" error={errors.description} hint="e.g. brakes squeak, aircon not cold, warning light on.">
        <textarea id="problem-text" rows={3} autoFocus maxLength={2000} className={inputClass} value={text} onChange={(e) => { setText(e.target.value); setErrors({}) }} />
      </Field>
      <Field label="Photo" htmlFor="problem-photo" error={errors.photo}>
        <input id="problem-photo" type="file" accept="image/*" capture="environment" className="block w-full text-sm" onChange={(e) => setPhoto(e.target.files[0] ?? null)} />
      </Field>
      <p className="text-xs text-slate-500">This opens a maintenance item for {vehicle.plate_number}. The vehicle stays available until the office decides.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Report problem'}</Button>
      </div>
    </form>
  )
}

export const licenseTone = { VALID: 'green', EXPIRING: 'gold', EXPIRED: 'red' }
export const licenseText = (d) => (d.license_status === 'EXPIRED' ? `Expired ${-d.license_days_left} days ago`
  : d.license_status === 'EXPIRING' ? `Expires in ${d.license_days_left} days` : 'Valid')

/** GET /api/driver/home/: profile, license, vehicles with warnings, month and year figures. */
export const useDriverHome = () => useQuery({ queryKey: ['/driver/home/'], queryFn: () => api.get('/driver/home/').then((r) => r.data) })

/** Things that need attention: license, papers, maintenance. [text, severe] */
export function driverWarnings(home) {
  if (!home?.driver) return []
  const d = home.driver
  const out = d.license_status === 'VALID' ? [] : [[`Your license: ${licenseText(d).toLowerCase()}`, d.license_status === 'EXPIRED']]
  for (const v of home.vehicles) {
    out.push(...v.documents.map((x) => [`${v.plate_number}: ${x.type} ${x.expired ? 'expired' : 'expires'} ${formatDate(x.expiry_date)}`, x.expired]))
    out.push(...v.maintenance.map((x) => [`${v.plate_number}: ${x.category} maintenance ${x.status === 'OVERDUE' ? 'overdue' : 'due soon'}`, x.status === 'OVERDUE']))
  }
  return out
}

export function Warnings({ items }) {
  if (!items.length) return null
  return (
    <ul aria-label="Needs attention" className="mb-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      {items.map(([text, bad]) => (
        <li key={text} className={`flex items-start gap-1.5 ${bad ? 'text-danger' : 'text-amber-900'}`}><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {text}</li>
      ))}
    </ul>
  )
}

const STATUS_TONE = { 'In Use': 'bg-brand-light text-brand', Serviceable: 'bg-green-50 text-green-800', 'Under Maintenance': 'bg-amber-50 text-amber-800', Unserviceable: 'bg-red-50 text-danger' }

/** One of the driver's vehicles: odometer, status, papers/maintenance, and Report a problem. Stacked, so it reads
 *  the same on a phone and in the narrow side column. */
export function VehicleCard({ v }) {
  const [reporting, setReporting] = useState(false)
  const warnings = driverWarnings({ driver: { license_status: 'VALID' }, vehicles: [v] })
  return (
    <section aria-label={`Vehicle ${v.plate_number}`} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <VehiclePhoto vehicle={{ photo_url: v.photo_url, plate_number: v.plate_number, make: '', model: v.label }} className="w-24 shrink-0 border border-slate-200" />
        <div className="min-w-0">
          <div className="text-lg leading-tight font-bold tracking-wide">{v.plate_number}</div>
          <div className="truncate text-sm text-slate-500">{v.label}</div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="flex items-center gap-1 text-xs text-slate-500"><Gauge size={12} aria-hidden="true" /> Odometer</dt>
          <dd className="font-semibold tabular-nums">{km(v.current_odometer)}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-500">Status</dt>
          <dd><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[v.status] ?? 'bg-slate-100 text-slate-700'}`}>{v.status}</span></dd>
        </div>
      </dl>
      {warnings.length ? (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm">
          {warnings.map(([text, bad]) => (
            <li key={text} className={`flex items-start gap-1.5 ${bad ? 'text-danger' : 'text-amber-900'}`}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {text.replace(`${v.plate_number}: `, '')}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          <CalendarCheck size={15} className="shrink-0" aria-hidden="true" /> Papers and maintenance up to date
        </p>
      )}
      <Button variant="secondary" className="w-full" onClick={() => setReporting(true)}><Wrench size={16} aria-hidden="true" /> Report a problem</Button>
      <Modal open={reporting} onClose={() => setReporting(false)} title={`Problem with ${v.plate_number}`}>
        {reporting && <ReportProblemForm vehicle={v} onClose={() => setReporting(false)} />}
      </Modal>
    </section>
  )
}

/** Ask the office to fix the driver's record (drivers cannot edit it themselves). */
export function CorrectionForm({ onClose }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const send = useDriverPost('/driver/request-correction/', 'Sent. The office will update your record.', onClose)
  const submit = (e) => {
    e.preventDefault()
    if (!text.trim()) return setError('Say what needs correcting')
    send.mutate({ message: text }, { onError: (err) => {
      const rest = applyFieldErrors(err, (_, v) => setError(v.message), ['message'])
      if (rest) setError(rest)
    } })
  }
  return (
    <form noValidate className="space-y-4" onSubmit={submit}>
      <Field label="What should be corrected? *" htmlFor="correction" error={error}
        hint="e.g. new mobile number, renewed license (new expiry date), wrong spelling of your name.">
        <textarea id="correction" rows={3} autoFocus maxLength={1000} className={inputClass} value={text} onChange={(e) => { setText(e.target.value); setError('') }} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Send to the office'}</Button>
      </div>
    </form>
  )
}
