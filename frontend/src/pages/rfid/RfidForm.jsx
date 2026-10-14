import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, invalidatePrefix, useList } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import { PROVIDERS } from './common'

const FIELDS = ['provider', 'account_number', 'vehicle', 'balance', 'is_active', 'remarks']
const money = (v) => (v === '' || v == null ? null : String(Number(String(v).replace(/,/g, ''))))

/** Add or edit an RFID / toll account. `vehicle` locks it to that vehicle (from the vehicle tab). */
export default function RfidForm({ account, vehicle, onClose, onSaved }) {
  const isNew = !account
  const qc = useQueryClient()
  const toast = useToast()
  const vehicles = useList('/vehicles/', { page_size: 500 })
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    defaultValues: account
      ? { provider: account.provider, account_number: account.account_number, vehicle: account.vehicle ? String(account.vehicle) : '',
          balance: account.balance ?? '', is_active: account.is_active, remarks: account.remarks }
      : { provider: 'EASYTRIP', account_number: '', vehicle: vehicle ? String(vehicle.id) : '', balance: '', is_active: true, remarks: '' },
  })

  const save = useMutation({
    mutationFn: (body) => (isNew ? api.post('/rfid-accounts/', body) : api.patch(`/rfid-accounts/${account.id}/`, body)),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/rfid-accounts/', '/vehicles/')
      toast(isNew ? 'RFID account added.' : 'RFID account updated.')
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => save.mutate({
    provider: v.provider, account_number: v.account_number, vehicle: v.vehicle ? Number(v.vehicle) : null,
    balance: money(v.balance), is_active: v.is_active, remarks: v.remarks,
  })

  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider *" htmlFor="rfid-provider" error={errors.provider?.message}>
          <select id="rfid-provider" className={inputClass} {...register('provider')}>
            {PROVIDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Account / tag number *" htmlFor="rfid-number" error={errors.account_number?.message}>
          <input id="rfid-number" className={`${inputClass} uppercase`} placeholder="e.g. 0101 2345 6789" {...register('account_number', { required: 'Enter the account number' })} />
        </Field>
      </div>

      {vehicle ? (
        <div>
          <span className="mb-1 block text-sm font-medium">Assigned vehicle</span>
          <input type="hidden" {...register('vehicle')} />
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{vehicle.plate_number} · {vehicle.make} {vehicle.model}</div>
        </div>
      ) : (
        <Field label="Assigned vehicle" htmlFor="rfid-vehicle" error={errors.vehicle?.message} hint="Leave blank to keep the account in the motor pool (unassigned).">
          <select id="rfid-vehicle" className={inputClass} {...register('vehicle')}>
            <option value="">Unassigned</option>
            {vehicles.data?.results.map((x) => <option key={x.id} value={x.id}>{x.plate_number} · {x.make} {x.model}</option>)}
          </select>
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Recorded balance (₱)" htmlFor="rfid-balance" error={errors.balance?.message} hint="Optional. The latest balance from the provider's portal.">
          <input id="rfid-balance" className={inputClass} inputMode="decimal" placeholder="0.00" {...register('balance')} />
        </Field>
        <label className="mt-7 flex items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" {...register('is_active')} />
          Active
        </label>
      </div>

      <Field label="Remarks" htmlFor="rfid-remarks" error={errors.remarks?.message}>
        <textarea id="rfid-remarks" rows={2} className={inputClass} {...register('remarks')} />
      </Field>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Add account' : 'Save changes'}</Button>
      </div>
    </form>
  )
}
