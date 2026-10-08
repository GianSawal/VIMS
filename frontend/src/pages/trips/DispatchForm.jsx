import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, invalidatePrefix, useList } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import { useAllOffices } from '../admin/Offices'
import { fromLocalInput, km, toLocalInput } from './common'

const DISPATCHABLE = ['SERVICEABLE', 'IN_USE']

const schema = z.object({
  ticket_number: z.string().max(40),
  vehicle: z.string().min(1, 'Select a vehicle'),
  driver: z.string().min(1, 'Select a driver'),
  requesting_office: z.string(),
  passengers: z.string(),
  origin: z.string().trim().min(1, 'Origin is required').max(200),
  destination: z.string().trim().min(1, 'Destination is required').max(255),
  purpose: z.string().trim().min(1, 'Purpose is required'),
  departed_at: z.string().min(1, 'Departure time is required'),
  odometer_start: z.string().trim().refine((v) => /^\d+$/.test(v), 'Enter the odometer in whole km'),
  remarks: z.string(),
})
const FIELDS = Object.keys(schema.shape)

/** Modal body. `vehicle` (optional) pre-selects and locks the vehicle, e.g. from a vehicle's Trips tab. */
export default function DispatchForm({ vehicle, onClose, onSaved }) {
  const qc = useQueryClient()
  const toast = useToast()
  const offices = useAllOffices()
  const vehicles = useList('/vehicles/', { page_size: 500 }) // ponytail: fine for a regional fleet; switch to a search box past ~500
  const drivers = useList('/drivers/', { page_size: 500, is_active: true })
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      ...Object.fromEntries(FIELDS.map((k) => [k, ''])),
      vehicle: vehicle ? String(vehicle.id) : '',
      departed_at: toLocalInput(),
      odometer_start: vehicle ? String(vehicle.current_odometer) : '',
    },
  })
  const chosen = vehicles.data?.results.find((v) => String(v.id) === watch('vehicle')) ?? vehicle

  const save = useMutation({
    mutationFn: (body) => api.post('/trips/', body),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/trips/', '/vehicles/')
      toast(`Trip ${data.ticket_number} dispatched.`)
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => save.mutate({
    ...v,
    vehicle: Number(v.vehicle),
    driver: Number(v.driver),
    requesting_office: v.requesting_office ? Number(v.requesting_office) : null,
    departed_at: fromLocalInput(v.departed_at),
    odometer_start: Number(v.odometer_start),
  })

  const text = (name, label, { hint, ...props } = {}) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message} hint={hint}>
      <input id={name} className={inputClass} {...register(name)} {...props} />
    </Field>
  )
  const vehicleField = register('vehicle')

  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}

      {vehicle ? (
        <div>
          <span className="mb-1 block text-sm font-medium">Vehicle</span>
          <input type="hidden" {...vehicleField} />
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{vehicle.plate_number} · {vehicle.make} {vehicle.model}</div>
        </div>
      ) : (
        <Field label="Vehicle *" htmlFor="vehicle" error={errors.vehicle?.message}>
          <select id="vehicle" className={inputClass} {...vehicleField}
            onChange={(e) => {
              vehicleField.onChange(e)
              const v = vehicles.data?.results.find((x) => String(x.id) === e.target.value)
              if (v) setValue('odometer_start', String(v.current_odometer))
            }}>
            <option value="">Select…</option>
            {vehicles.data?.results.map((v) => (
              <option key={v.id} value={v.id} disabled={!DISPATCHABLE.includes(v.status)}>
                {v.plate_number} · {v.make} {v.model}{DISPATCHABLE.includes(v.status) ? '' : ` (${v.status_display})`}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Driver *" htmlFor="driver" error={errors.driver?.message}>
        <select id="driver" className={inputClass} {...register('driver')}>
          <option value="">Select…</option>
          {drivers.data?.results.map((d) => (
            <option key={d.id} value={d.id} disabled={d.license_status === 'EXPIRED'}>
              {d.full_name} ({d.office_code}){d.license_status === 'EXPIRED' ? ' – license expired' : ''}
            </option>
          ))}
        </select>
      </Field>

      {text('departed_at', 'Departure *', { type: 'datetime-local' })}
      {text('odometer_start', 'Starting odometer (km) *', {
        inputMode: 'numeric',
        hint: chosen ? `Vehicle is at ${km(chosen.current_odometer)}; cannot start lower.` : undefined,
      })}

      {text('origin', 'Origin *', { placeholder: 'e.g. DOLE Regional Office' })}
      {text('destination', 'Destination / places visited *')}
      <div className="sm:col-span-2">
        <Field label="Purpose *" htmlFor="purpose" error={errors.purpose?.message}>
          <textarea id="purpose" rows={2} className={inputClass} {...register('purpose')} />
        </Field>
      </div>

      <Field label="Requesting office" htmlFor="requesting_office" error={errors.requesting_office?.message}>
        <select id="requesting_office" className={inputClass} {...register('requesting_office')}>
          <option value="">None</option>
          {offices.data?.results.filter((o) => o.is_active).map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
        </select>
      </Field>
      {text('ticket_number', 'Trip ticket no.', { placeholder: 'Leave blank to auto-number', className: `${inputClass} uppercase` })}
      <div className="sm:col-span-2">
        <Field label="Passengers" htmlFor="passengers" error={errors.passengers?.message}>
          <textarea id="passengers" rows={2} className={inputClass} placeholder="One name per line" {...register('passengers')} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Remarks" htmlFor="remarks" error={errors.remarks?.message}>
          <textarea id="remarks" rows={2} className={inputClass} {...register('remarks')} />
        </Field>
      </div>

      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Dispatching…' : 'Dispatch trip'}</Button>
      </div>
    </form>
  )
}
