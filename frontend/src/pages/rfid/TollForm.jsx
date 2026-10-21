import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, invalidatePrefix, useList } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import { providerLabel } from './common'

const FIELDS = ['account', 'vehicle', 'trip', 'transacted_at', 'kind', 'amount', 'description', 'reference_number']
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const amount = (v) => String(Number(String(v).replace(/,/g, '')))

/** Record a toll load (credit) or charge (debit). `account`/`vehicle`/`trip` pre-fill from where it's opened. */
export default function TollForm({ txn, account, vehicle, trip, onClose, onSaved }) {
  const isNew = !txn
  const qc = useQueryClient()
  const toast = useToast()
  const accounts = useList('/rfid-accounts/', { page_size: 500 })
  const vehicles = useList('/vehicles/', { page_size: 500 })
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    defaultValues: txn
      ? { account: String(txn.account), vehicle: String(txn.vehicle), trip: txn.trip ? String(txn.trip) : '',
          transacted_at: txn.transacted_at?.slice(0, 16), kind: Number(txn.credit) > 0 ? 'credit' : 'debit',
          amount: String(Number(txn.credit) > 0 ? txn.credit : txn.debit), description: txn.description, reference_number: txn.reference_number }
      : { account: account ? String(account.id) : '', vehicle: vehicle ? String(vehicle.id) : (trip?.vehicle ? String(trip.vehicle) : (account?.vehicle ? String(account.vehicle) : '')),
          trip: trip ? String(trip.id) : '', transacted_at: nowLocal(), kind: 'debit', amount: '', description: '', reference_number: '' },
  })

  const chosenAccount = accounts.data?.results.find((a) => String(a.id) === watch('account'))
  const fixedVehicle = vehicle?.id ?? trip?.vehicle ?? null // opened from a vehicle tab or trip ticket
  const pickable = (accounts.data?.results ?? []).filter((a) => (a.is_active || String(a.id) === watch('account'))
    && (fixedVehicle == null || a.vehicle == null || a.vehicle === fixedVehicle))
  const lockedVehicle = chosenAccount?.vehicle ?? null // an assigned account fixes the vehicle
  const vehicleId = lockedVehicle ? String(lockedVehicle) : watch('vehicle')
  const trips = useList('/trips/', vehicleId ? { vehicle: vehicleId, page_size: 50 } : {})

  const save = useMutation({
    mutationFn: (body) => (isNew ? api.post('/toll-transactions/', body) : api.patch(`/toll-transactions/${txn.id}/`, body)),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/toll-transactions/', '/rfid-accounts/')
      toast(isNew ? 'Toll transaction recorded.' : 'Toll transaction updated.')
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => {
    const vid = lockedVehicle ?? (v.vehicle ? Number(v.vehicle) : null)
    save.mutate({
      account: Number(v.account), vehicle: vid, trip: v.trip ? Number(v.trip) : null,
      transacted_at: new Date(v.transacted_at).toISOString(),
      credit: v.kind === 'credit' ? amount(v.amount) : '0', debit: v.kind === 'debit' ? amount(v.amount) : '0',
      description: v.description, reference_number: v.reference_number,
    })
  }

  const kind = watch('kind')

  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

      {account ? (
        <div>
          <span className="mb-1 block text-sm font-medium">Account</span>
          <input type="hidden" {...register('account')} />
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{providerLabel[account.provider]} {account.masked_account}</div>
        </div>
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

      {lockedVehicle ? (
        <div>
          <span className="mb-1 block text-sm font-medium">Vehicle</span>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{chosenAccount.plate_number} · {chosenAccount.vehicle_label} <span className="text-slate-400">(from the account)</span></div>
        </div>
      ) : vehicle ? (
        <div>
          <span className="mb-1 block text-sm font-medium">Vehicle</span>
          <input type="hidden" {...register('vehicle')} />
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{vehicle.plate_number}{vehicle.make ? ` · ${vehicle.make} ${vehicle.model}` : ''}</div>
        </div>
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`${kind === 'credit' ? 'Load' : 'Charge'} amount (₱) *`} htmlFor="toll-amount" error={errors.amount?.message}>
          <input id="toll-amount" className={inputClass} inputMode="decimal" placeholder="0.00"
            {...register('amount', { required: 'Enter the amount', validate: (v) => Number(String(v).replace(/,/g, '')) > 0 || 'Must be more than zero' })} />
        </Field>
        <Field label="Reference number" htmlFor="toll-ref" error={errors.reference_number?.message}>
          <input id="toll-ref" className={`${inputClass} uppercase`} placeholder="Receipt / transaction no." {...register('reference_number')} />
        </Field>
      </div>

      <Field label="Description *" htmlFor="toll-desc" error={errors.description?.message} hint="e.g. NLEX Balintawak, SLEX reload">
        <input id="toll-desc" className={inputClass} {...register('description', { required: 'Describe the transaction' })} />
      </Field>

      {trip ? (
        <div>
          <span className="mb-1 block text-sm font-medium">Trip</span>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{trip.ticket_number}{trip.destination ? ` · ${trip.destination}` : ''} <span className="text-slate-400">(linked to this ticket)</span></div>
        </div>
      ) : vehicleId && (trips.data?.results.length ?? 0) > 0 && (
        <Field label="Link to a trip" htmlFor="toll-trip" error={errors.trip?.message} hint="Optional. Attach this toll to one of the vehicle's trips.">
          <select id="toll-trip" className={inputClass} {...register('trip')}>
            <option value="">Not linked</option>
            {trips.data.results.map((tr) => <option key={tr.id} value={tr.id}>{tr.ticket_number} · {tr.destination}</option>)}
          </select>
        </Field>
      )}

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Record transaction' : 'Save changes'}</Button>
      </div>
    </form>
  )
}
