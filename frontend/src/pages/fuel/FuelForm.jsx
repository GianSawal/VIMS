import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, invalidatePrefix, useList } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import { todayISO } from '../drivers/common'
import { FUELS, formatKm, formatPeso, odometerField, parseKm } from '../vehicles/common'

const decimal = (msg) => z.string().trim().refine((v) => /^\d+(\.\d+)?$/.test(v.replace(/,/g, '')) && Number(v.replace(/,/g, '')) > 0, msg)

const schema = z.object({
  vehicle: z.string().min(1, 'Select a vehicle'),
  date: z.string().min(1, 'Date is required'),
  driver: z.string(),
  fuel_type: z.string().min(1, 'Select the fuel type'),
  liters: decimal('Enter liters, e.g. 40 or 40.5'),
  unit_price: decimal('Enter the price per liter, e.g. 60.50'),
  total_amount: z.string().trim().refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, '')), 'Enter an amount like 2420.00, or leave blank'),
  odometer: odometerField(),
  is_full_tank: z.boolean(),
  po_number: z.string().max(40),
  supplier: z.string().max(150),
  receipt_number: z.string().max(40),
  remarks: z.string(),
})
const FIELDS = Object.keys(schema.shape)
const num = (v) => Number(String(v).replace(/,/g, ''))

/** Modal body. `record` = edit; `vehicle` = new record locked to that vehicle (vehicle Fuel tab). */
export default function FuelForm({ record, vehicle, onClose, onSaved }) {
  const isNew = !record
  const qc = useQueryClient()
  const toast = useToast()
  const vehicles = useList('/vehicles/', { page_size: 500 })
  const drivers = useList('/drivers/', { page_size: 500, is_active: true })
  const [error, setFormError] = useState('')
  const locked = vehicle ?? (record && { id: record.vehicle, plate_number: record.plate_number })
  const { register, handleSubmit, setError, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: record
      ? { ...Object.fromEntries(FIELDS.map((k) => [k, record[k] == null ? '' : String(record[k])])), is_full_tank: record.is_full_tank }
      : {
        ...Object.fromEntries(FIELDS.map((k) => [k, ''])), date: todayISO(), is_full_tank: false,
        vehicle: vehicle ? String(vehicle.id) : '', fuel_type: vehicle?.fuel_type ?? '',
      },
  })
  const chosen = vehicles.data?.results.find((v) => String(v.id) === watch('vehicle')) ?? vehicle
  const liters = num(watch('liters'))
  const price = num(watch('unit_price'))
  const computed = liters > 0 && price > 0 ? Math.round(liters * price * 100) / 100 : null

  const save = useMutation({
    mutationFn: (body) => (isNew ? api.post('/fuel-records/', body) : api.patch(`/fuel-records/${record.id}/`, body)),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/fuel-records/', '/vehicles/')
      toast(isNew ? `Fuel record saved: ${data.liters} L for ${data.plate_number}.` : 'Fuel record updated.')
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => save.mutate({
    ...v,
    vehicle: Number(v.vehicle),
    driver: v.driver ? Number(v.driver) : null,
    liters: String(num(v.liters)),
    unit_price: String(num(v.unit_price)),
    total_amount: v.total_amount ? String(num(v.total_amount)) : null,
    odometer: Number(parseKm(v.odometer)),
  })

  const text = (name, label, { hint, ...props } = {}) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message} hint={hint}>
      <input id={name} className={inputClass} {...register(name)} {...props} />
    </Field>
  )
  const vehicleField = register('vehicle')

  return (
    <form noValidate className="space-y-5" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

      <Group title="Vehicle and date">
        {locked ? (
          <div>
            <span className="mb-1 block text-sm font-medium">Vehicle</span>
            <input type="hidden" {...vehicleField} />
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{locked.plate_number}{vehicle ? ` · ${vehicle.make} ${vehicle.model}` : ''}</div>
          </div>
        ) : (
          <Field label="Vehicle *" htmlFor="vehicle" error={errors.vehicle?.message}>
            <select id="vehicle" className={inputClass} {...vehicleField} onChange={(e) => {
              vehicleField.onChange(e)
              const v = vehicles.data?.results.find((x) => String(x.id) === e.target.value)
              if (v) setValue('fuel_type', v.fuel_type)
            }}>
              <option value="">Select a vehicle…</option>
              {vehicles.data?.results.map((v) => <option key={v.id} value={v.id}>{v.plate_number} · {v.make} {v.model}</option>)}
            </select>
          </Field>
        )}
        {text('date', 'Date of fill-up *', { type: 'date', max: todayISO() })}
        <Field label="Driver" htmlFor="driver" error={errors.driver?.message}>
          <select id="driver" className={inputClass} {...register('driver')}>
            <option value="">Not recorded</option>
            {drivers.data?.results.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.office_code})</option>)}
          </select>
        </Field>
        <Field label="Fuel type *" htmlFor="fuel_type" error={errors.fuel_type?.message}>
          <select id="fuel_type" className={inputClass} {...register('fuel_type')}>
            <option value="">Select…</option>
            {FUELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </Group>

      <Group title="Quantity and cost">
        {text('liters', 'Liters *', { inputMode: 'decimal', placeholder: '40.000' })}
        {text('unit_price', 'Price per liter (₱) *', { inputMode: 'decimal', placeholder: '60.50' })}
        {text('total_amount', 'Total on receipt (₱)', {
          inputMode: 'decimal',
          placeholder: computed ? computed.toFixed(2) : 'Computed automatically',
          hint: computed ? `Liters × price = ${formatPeso(computed)}. Leave blank to use it; the receipt total may differ by up to ₱1.` : 'Leave blank to compute liters × price.',
        })}
      </Group>

      <Group title="Odometer">
        {text('odometer', 'Odometer at fill-up (km) *', {
          inputMode: 'numeric',
          hint: chosen?.current_odometer != null ? `Vehicle is at ${formatKm(chosen.current_odometer)}. It must fit between the previous and next fill-ups.` : 'Read it from the dashboard at the pump.',
        })}
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:mt-6">
          <input type="checkbox" className="mt-0.5" {...register('is_full_tank')} />
          <span><span className="font-medium">Filled to full tank</span><span className="block text-xs text-slate-500">Needed for an estimated km/L. Partial fills are counted but not estimated.</span></span>
        </label>
      </Group>

      <Group title="Purchase order and receipt" note="Optional">
        {text('po_number', 'PO number', { className: `${inputClass} uppercase`, hint: 'Records with a PO number appear in the Fuel PO log.' })}
        {text('supplier', 'Supplier / station', { placeholder: 'e.g. Petron, Tarlac City' })}
        {text('receipt_number', 'Receipt / reference no.', { className: `${inputClass} uppercase` })}
        <Field label="Remarks" htmlFor="remarks" error={errors.remarks?.message}>
          <textarea id="remarks" rows={1} className={inputClass} {...register('remarks')} />
        </Field>
      </Group>

      <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Save fuel record' : 'Save changes'}</Button>
      </div>
    </form>
  )
}

function Group({ title, note, children }) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-brand">{title}{note && <span className="font-normal text-slate-400"> · {note}</span>}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}
