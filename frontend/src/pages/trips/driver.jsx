import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarCheck, CheckCircle2, Gauge, IdCard, Milestone, Wrench, XCircle } from 'lucide-react'
import { api, applyFieldErrors, invalidatePrefix } from '../../api'
import { Badge, Button, Field, inputClass, Modal } from '../../components/ui'
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

const licenseTone = { VALID: 'green', EXPIRING: 'gold', EXPIRED: 'red' }
const licenseText = (d) => (d.license_status === 'EXPIRED' ? `Expired ${-d.license_days_left} days ago`
  : d.license_status === 'EXPIRING' ? `Expires in ${d.license_days_left} days` : 'Valid')

/** Top of My trips: license, this month, and each of the driver's vehicles with its warnings. */
export function DriverHome() {
  const home = useQuery({ queryKey: ['/driver/home/'], queryFn: () => api.get('/driver/home/').then((r) => r.data) })
  const [reporting, setReporting] = useState(null)
  const d = home.data?.driver
  if (!d) return null
  const m = home.data.month
  return (
    <div className="mb-6 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-label="My license" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand"><IdCard size={20} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500">License {d.license_number} · {d.license_type}</div>
            <div className="font-semibold">Until {formatDate(d.license_expiry_date)}</div>
          </div>
          <Badge tone={licenseTone[d.license_status]} dot>{licenseText(d)}</Badge>
        </section>
        <section aria-label="This month" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Milestone size={20} aria-hidden="true" /></span>
          <div>
            <div className="text-xs text-slate-500">This month</div>
            <div className="font-semibold">{m.trips} trip{m.trips === 1 ? '' : 's'} completed · {km(m.distance_km)}</div>
          </div>
        </section>
      </div>
      {home.data.vehicles.map((v) => {
        const warnings = [
          ...v.documents.map((x) => [`${x.type} ${x.expired ? 'expired' : 'expires'} ${formatDate(x.expiry_date)}`, x.expired]),
          ...v.maintenance.map((x) => [`${x.category} maintenance ${x.status === 'OVERDUE' ? 'overdue' : 'due soon'}`, x.status === 'OVERDUE']),
        ]
        return (
          <section key={v.id} aria-label={`My vehicle ${v.plate_number}`} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <VehiclePhoto vehicle={{ photo_url: v.photo_url, plate_number: v.plate_number, make: '', model: v.label }} className="w-24 shrink-0 border border-slate-200" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold tracking-wide">{v.plate_number} <span className="font-normal text-slate-500">{v.label}</span></div>
              <div className="mt-0.5 flex flex-wrap gap-x-4 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1"><Gauge size={14} aria-hidden="true" /> {km(v.current_odometer)}</span>
                <span>{v.status}</span>
              </div>
              {warnings.length ? (
                <ul className="mt-2 space-y-0.5 text-sm">
                  {warnings.map(([text, bad]) => (
                    <li key={text} className={`flex items-center gap-1.5 ${bad ? 'text-danger' : 'text-amber-800'}`}><AlertTriangle size={14} aria-hidden="true" /> {text}</li>
                  ))}
                </ul>
              ) : <p className="mt-2 flex items-center gap-1.5 text-sm text-green-700"><CalendarCheck size={14} aria-hidden="true" /> Papers and maintenance up to date</p>}
            </div>
            <Button variant="secondary" onClick={() => setReporting(v)}><Wrench size={16} aria-hidden="true" /> Report a problem</Button>
          </section>
        )
      })}
      <Modal open={!!reporting} onClose={() => setReporting(null)} title={reporting ? `Problem with ${reporting.plate_number}` : ''}>
        {reporting && <ReportProblemForm vehicle={reporting} onClose={() => setReporting(null)} />}
      </Modal>
    </div>
  )
}
