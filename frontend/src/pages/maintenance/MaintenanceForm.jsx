import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, invalidatePrefix, useList } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import { todayISO } from '../drivers/common'
import { formatKm, parseKm } from '../vehicles/common'
import { useCategories } from './common'

const money = (msg) => z.string().trim().refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, '')), msg)
const optionalOdo = z.string().trim().refine((v) => v === '' || /^\d+$/.test(parseKm(v)), 'Enter whole km, e.g. 45210')

const schema = z.object({
  vehicle: z.string().min(1, 'Select a vehicle'),
  date: z.string().min(1, 'Date is required'),
  categories: z.array(z.string()).min(1, 'Choose at least one category'),
  description: z.string().trim().min(1, 'Describe the work'),
  service_provider: z.string().max(150),
  reference_number: z.string().max(40),
  labor_cost: money('Enter an amount like 1500.00'),
  parts_cost: money('Enter an amount like 3200.00'),
  odometer: optionalOdo,
  next_service_date: z.string(),
  next_service_odometer: optionalOdo,
  remarks: z.string(),
})
const FIELDS = Object.keys(schema.shape)
const amount = (v) => (v === '' ? '0' : String(Number(v.replace(/,/g, ''))))

/** Modal body. `record` = edit (descriptive fields only); `vehicle` = new record locked to that vehicle. */
export default function MaintenanceForm({ record, vehicle, onClose, onSaved }) {
  const isNew = !record
  const qc = useQueryClient()
  const toast = useToast()
  const vehicles = useList('/vehicles/', { page_size: 500 })
  const cats = useCategories()
  const [error, setFormError] = useState('')
  const locked = vehicle ?? (record && { id: record.vehicle, plate_number: record.plate_number })
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: record
      ? {
        ...Object.fromEntries(FIELDS.map((k) => [k, record[k] == null ? '' : String(record[k])])),
        vehicle: String(record.vehicle), categories: record.categories.map(String),
        labor_cost: String(Number(record.labor_cost)), parts_cost: String(Number(record.parts_cost)),
      }
      : { ...Object.fromEntries(FIELDS.map((k) => [k, ''])), categories: [], date: todayISO(), vehicle: vehicle ? String(vehicle.id) : '', labor_cost: '', parts_cost: '' },
  })
  const chosen = vehicles.data?.results.find((v) => String(v.id) === watch('vehicle')) ?? vehicle
  const total = (Number(amount(watch('labor_cost') || '')) || 0) + (Number(amount(watch('parts_cost') || '')) || 0)

  const save = useMutation({
    mutationFn: (body) => (isNew ? api.post('/maintenance/', body) : api.patch(`/maintenance/${record.id}/`, body)),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/maintenance', '/vehicles/')
      toast(isNew ? 'Maintenance record saved.' : 'Maintenance record updated.')
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => save.mutate({
    vehicle: Number(v.vehicle), date: v.date, categories: v.categories.map(Number), description: v.description,
    service_provider: v.service_provider, reference_number: v.reference_number, remarks: v.remarks,
    labor_cost: amount(v.labor_cost), parts_cost: amount(v.parts_cost),
    odometer: v.odometer ? Number(parseKm(v.odometer)) : null,
    next_service_date: v.next_service_date || null,
    next_service_odometer: v.next_service_odometer ? Number(parseKm(v.next_service_odometer)) : null,
  })

  const text = (name, label, { hint, ...props } = {}) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message} hint={hint}>
      <input id={name} className={inputClass} {...register(name)} {...props} />
    </Field>
  )

  return (
    <form noValidate className="space-y-5" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

      <Group title="What and when">
        {locked ? (
          <div>
            <span className="mb-1 block text-sm font-medium">Vehicle</span>
            <input type="hidden" {...register('vehicle')} />
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{locked.plate_number}{vehicle ? ` · ${vehicle.make} ${vehicle.model}` : ''}</div>
          </div>
        ) : (
          <Field label="Vehicle *" htmlFor="vehicle" error={errors.vehicle?.message}>
            <select id="vehicle" className={inputClass} {...register('vehicle')}>
              <option value="">Select a vehicle…</option>
              {vehicles.data?.results.map((v) => <option key={v.id} value={v.id}>{v.plate_number} · {v.make} {v.model}</option>)}
            </select>
          </Field>
        )}
        {text('date', 'Date *', { type: 'date', hint: 'When the work is booked or done.' })}
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Categories * <span className="font-normal text-slate-500">(one or more)</span></legend>
          <div className="flex flex-wrap gap-2">
            {cats.data?.map((c) => (
              <label key={c.id} className="cursor-pointer">
                <input type="checkbox" value={String(c.id)} className="peer sr-only" {...register('categories')} />
                <span className="inline-block rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-gold">{c.name}</span>
              </label>
            ))}
          </div>
          {errors.categories && <p className="mt-1 text-sm text-danger">{errors.categories.message}</p>}
        </fieldset>
        <div className="sm:col-span-2">
          <Field label="Description of work *" htmlFor="description" error={errors.description?.message}>
            <textarea id="description" rows={2} className={inputClass} placeholder="e.g. Change oil, oil filter and air filter; rotate tires" {...register('description')} />
          </Field>
        </div>
      </Group>

      <Group title="Supplier and cost">
        {text('service_provider', 'Supplier / service provider', { placeholder: 'e.g. Toyota Tarlac' })}
        {text('reference_number', 'PR / reference number', { className: `${inputClass} uppercase` })}
        {text('labor_cost', 'Labor cost (₱)', { inputMode: 'decimal', placeholder: '0.00' })}
        {text('parts_cost', 'Parts cost (₱)', { inputMode: 'decimal', placeholder: '0.00', hint: `Total: ₱${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` })}
      </Group>

      <Group title="Odometer and next service" note="Optional">
        {text('odometer', 'Odometer at service (km)', { inputMode: 'numeric', hint: chosen?.current_odometer != null ? `Vehicle is at ${formatKm(chosen.current_odometer)}.` : undefined })}
        <div />
        {text('next_service_date', 'Next service date', { type: 'date', hint: 'Left blank, it is suggested from the vehicle’s preventive schedule when the job is completed.' })}
        {text('next_service_odometer', 'Next service odometer (km)', { inputMode: 'numeric' })}
        <div className="sm:col-span-2">
          <Field label="Remarks" htmlFor="remarks" error={errors.remarks?.message}>
            <textarea id="remarks" rows={1} className={inputClass} {...register('remarks')} />
          </Field>
        </div>
      </Group>

      <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Save record' : 'Save changes'}</Button>
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
