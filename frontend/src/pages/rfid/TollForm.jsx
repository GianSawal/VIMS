import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDownCircle, ArrowUpCircle, Plus, Trash2 } from 'lucide-react'
import { api, applyFieldErrors, errorMessage, invalidatePrefix, useList } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import { providerLabel } from './common'

const EDIT_FIELDS = ['account', 'vehicle', 'trip', 'transacted_at', 'kind', 'amount', 'description', 'reference_number']
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0
const amount = (v) => String(num(v))

/**
 * Record toll. A new entry can hold one optional reload (credit) and any number of toll charges (debit) from
 * the same trip; each is saved as its own transaction in one all-or-nothing batch. Editing changes a single row.
 * `account`/`vehicle`/`trip` pre-fill from where the form is opened.
 */
export default function TollForm({ txn, account, vehicle, trip, onClose, onSaved }) {
  const isNew = !txn
  const qc = useQueryClient()
  const toast = useToast()
  const accounts = useList('/rfid-accounts/', { page_size: 500 })
  const vehicles = useList('/vehicles/', { page_size: 500 })
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, watch, control, formState: { errors } } = useForm({
    defaultValues: txn
      ? { account: String(txn.account), vehicle: String(txn.vehicle), trip: txn.trip ? String(txn.trip) : '',
          transacted_at: txn.transacted_at?.slice(0, 16), kind: Number(txn.credit) > 0 ? 'credit' : 'debit',
          amount: String(Number(txn.credit) > 0 ? txn.credit : txn.debit), description: txn.description, reference_number: txn.reference_number }
      : { account: account ? String(account.id) : '', vehicle: vehicle ? String(vehicle.id) : (trip?.vehicle ? String(trip.vehicle) : (account?.vehicle ? String(account.vehicle) : '')),
          trip: trip ? String(trip.id) : '', transacted_at: nowLocal(),
          load_amount: '', load_reference: '', charges: [{ amount: '', description: '', reference_number: '' }] },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'charges' })

  const chosenAccount = accounts.data?.results.find((a) => String(a.id) === watch('account'))
  const fixedVehicle = vehicle?.id ?? trip?.vehicle ?? null
  const pickable = (accounts.data?.results ?? []).filter((a) => (a.is_active || String(a.id) === watch('account'))
    && (fixedVehicle == null || a.vehicle == null || a.vehicle === fixedVehicle))
  const lockedVehicle = chosenAccount?.vehicle ?? null
  const vehicleId = lockedVehicle ? String(lockedVehicle) : watch('vehicle')
  const trips = useList('/trips/', vehicleId ? { vehicle: vehicleId, page_size: 50 } : {})

  const save = useMutation({
    mutationFn: (body) => (isNew ? api.post('/toll-transactions/batch/', body) : api.patch(`/toll-transactions/${txn.id}/`, body)),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/toll-transactions/', '/rfid-accounts/', '/trips/')
      toast(isNew ? `${data.count ?? 1} toll transaction${(data.count ?? 1) === 1 ? '' : 's'} recorded.` : 'Toll transaction updated.')
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(isNew ? errorMessage(err) : applyFieldErrors(err, setError, EDIT_FIELDS)),
  })

  const submit = (v) => {
    const vid = lockedVehicle ?? (v.vehicle ? Number(v.vehicle) : null)
    const shared = { account: Number(v.account), vehicle: vid, trip: v.trip ? Number(v.trip) : null, transacted_at: new Date(v.transacted_at).toISOString() }
    if (!isNew) { save.mutate({ ...shared, credit: v.kind === 'credit' ? amount(v.amount) : '0', debit: v.kind === 'debit' ? amount(v.amount) : '0', description: v.description, reference_number: v.reference_number }); return }

    const items = []
    if (num(v.load_amount) > 0) items.push({ kind: 'credit', amount: amount(v.load_amount), description: 'Reload', reference_number: v.load_reference })
    for (const c of v.charges) if (num(c.amount) > 0) items.push({ kind: 'debit', amount: amount(c.amount), description: c.description, reference_number: c.reference_number })
    if (items.length === 0) { setFormError('Enter a reload amount, or at least one toll charge.'); return }
    if (items.some((it) => it.kind === 'debit' && !it.description.trim())) { setFormError('Each toll charge needs a description.'); return }
    setFormError('')
    save.mutate({ ...shared, items })
  }

  const kind = watch('kind')

  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

      {/* Account */}
      {account ? (
        <Locked label="Account"><input type="hidden" {...register('account')} />{providerLabel[account.provider]} {account.masked_account}</Locked>
      ) : (
        <Field label="Account *" htmlFor="toll-account" error={errors.account?.message}>
          <select id="toll-account" className={inputClass} {...register('account', { required: 'Choose an account' })}>
            <option value="">Select an account…</option>
            {pickable.map((a) => (
              <option key={a.id} value={a.id}>{providerLabel[a.provider]} {a.masked_account}{a.plate_number ? ` · ${a.plate_number}` : ' · unassigned'}</option>
            ))}
          </select>
        </Field>
      )}

      {/* Vehicle */}
      {lockedVehicle ? (
        <Locked label="Vehicle">{chosenAccount.plate_number} · {chosenAccount.vehicle_label} <span className="text-slate-400">(from the account)</span></Locked>
      ) : vehicle ? (
        <Locked label="Vehicle"><input type="hidden" {...register('vehicle')} />{vehicle.plate_number}{vehicle.make ? ` · ${vehicle.make} ${vehicle.model}` : ''}</Locked>
      ) : (
        <Field label="Vehicle *" htmlFor="toll-vehicle" error={errors.vehicle?.message}>
          <select id="toll-vehicle" className={inputClass} {...register('vehicle', { required: 'Choose a vehicle' })}>
            <option value="">Select a vehicle…</option>
            {vehicles.data?.results.map((x) => <option key={x.id} value={x.id}>{x.plate_number} · {x.make} {x.model}</option>)}
          </select>
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date and time *" htmlFor="toll-when" error={errors.transacted_at?.message}>
          <input id="toll-when" type="datetime-local" max={nowLocal()} className={inputClass} {...register('transacted_at', { required: 'Required' })} />
        </Field>
        {/* Trip */}
        {trip ? (
          <Locked label="Trip">{trip.ticket_number}{trip.destination ? ` · ${trip.destination}` : ''} <span className="text-slate-400">(linked)</span></Locked>
        ) : vehicleId && (trips.data?.results.length ?? 0) > 0 ? (
          <Field label="Link to a trip" htmlFor="toll-trip" error={errors.trip?.message}>
            <select id="toll-trip" className={inputClass} {...register('trip')}>
              <option value="">Not linked</option>
              {trips.data.results.map((tr) => <option key={tr.id} value={tr.id}>{tr.ticket_number} · {tr.destination}</option>)}
            </select>
          </Field>
        ) : <div />}
      </div>

      {isNew ? (
        <>
          {/* Reload (optional) */}
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-emerald-700"><ArrowUpCircle size={16} /> Reload</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Load amount (₱)" htmlFor="load-amt">
                <input id="load-amt" className={inputClass} inputMode="decimal" placeholder="0.00" {...register('load_amount')} />
              </Field>
              <Field label="Reference number" htmlFor="load-ref">
                <input id="load-ref" className={`${inputClass} uppercase`} placeholder="Reload receipt no." {...register('load_reference')} />
              </Field>
            </div>
          </fieldset>

          {/* Toll charges (repeatable) */}
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-danger"><ArrowDownCircle size={16} /> Toll charges</legend>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[7rem_1fr_7rem_auto] items-start gap-2">
                  <input aria-label={`Charge ${i + 1} amount`} className={inputClass} inputMode="decimal" placeholder="₱ 0.00" {...register(`charges.${i}.amount`)} />
                  <input aria-label={`Charge ${i + 1} toll plaza`} className={inputClass} placeholder="Toll plaza, e.g. NLEX Balintawak" {...register(`charges.${i}.description`)} />
                  <input aria-label={`Charge ${i + 1} reference`} className={`${inputClass} uppercase`} placeholder="Ref no." {...register(`charges.${i}.reference_number`)} />
                  <button type="button" onClick={() => remove(i)} disabled={fields.length === 1} aria-label={`Remove charge ${i + 1}`}
                    className="mt-1 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger disabled:opacity-30"><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
            <Button variant="ghost" className="mt-2 px-2" onClick={() => append({ amount: '', description: '', reference_number: '' })}><Plus size={16} /> Add another toll</Button>
          </fieldset>
          <p className="text-xs text-slate-500">Fill the reload and the tolls that happened on this trip. Each line is saved as its own transaction.</p>
        </>
      ) : (
        <>
          <div>
            <span className="mb-1 block text-sm font-medium">Type *</span>
            <div className="flex gap-2">
              {[['debit', 'Charge (toll)'], ['credit', 'Load (reload)']].map(([k, l]) => (
                <label key={k} className="flex-1 cursor-pointer">
                  <input type="radio" value={k} className="peer sr-only" {...register('kind')} />
                  <span className="block rounded-md border border-slate-300 px-3 py-2 text-center text-sm peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white">{l}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${kind === 'credit' ? 'Load' : 'Charge'} amount (₱) *`} htmlFor="toll-amount" error={errors.amount?.message}>
              <input id="toll-amount" className={inputClass} inputMode="decimal" placeholder="0.00"
                {...register('amount', { required: 'Enter the amount', validate: (v) => num(v) > 0 || 'Must be more than zero' })} />
            </Field>
            <Field label="Reference number" htmlFor="toll-ref" error={errors.reference_number?.message}>
              <input id="toll-ref" className={`${inputClass} uppercase`} placeholder="Receipt / transaction no." {...register('reference_number')} />
            </Field>
          </div>
          <Field label="Description *" htmlFor="toll-desc" error={errors.description?.message} hint="e.g. NLEX Balintawak, SLEX reload">
            <input id="toll-desc" className={inputClass} {...register('description', { required: 'Describe the transaction' })} />
          </Field>
        </>
      )}

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Record toll' : 'Save changes'}</Button>
      </div>
    </form>
  )
}

function Locked({ label, children }) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{children}</div>
    </div>
  )
}
