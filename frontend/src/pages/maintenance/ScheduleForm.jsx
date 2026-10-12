import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, invalidatePrefix, useList } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import { formatKm, parseKm } from '../vehicles/common'
import { useCategories } from './common'

const wholeOrBlank = (msg) => z.string().trim().refine((v) => v === '' || /^\d+$/.test(parseKm(v)), msg)

const schema = z.object({
  vehicle: z.string().min(1, 'Select a vehicle'),
  category: z.string().min(1, 'Select a category'),
  interval_days: wholeOrBlank('Enter whole days, e.g. 180'),
  interval_km: wholeOrBlank('Enter whole km, e.g. 5000'),
  last_service_date: z.string(),
  last_service_odometer: wholeOrBlank('Enter whole km'),
  is_active: z.boolean(),
}).refine((v) => v.interval_days || v.interval_km, { path: ['interval_days'], message: 'Set a day interval, a km interval, or both' })
const FIELDS = ['vehicle', 'category', 'interval_days', 'interval_km', 'last_service_date', 'last_service_odometer']
const orNull = (v) => (v ? Number(parseKm(v)) : null)

/** Preventive-maintenance rule: due when EITHER interval is reached. `schedule` = edit; `vehicle` = locked to that vehicle. */
export default function ScheduleForm({ schedule, vehicle, onClose }) {
  const isNew = !schedule
  const qc = useQueryClient()
  const toast = useToast()
  const vehicles = useList('/vehicles/', { page_size: 500 })
  const cats = useCategories()
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: schedule
      ? {
        vehicle: String(schedule.vehicle), category: String(schedule.category), interval_days: schedule.interval_days ?? '',
        interval_km: schedule.interval_km ?? '', last_service_date: schedule.last_service_date ?? '',
        last_service_odometer: schedule.last_service_odometer ?? '', is_active: schedule.is_active,
      }
      : { vehicle: vehicle ? String(vehicle.id) : '', category: '', interval_days: '', interval_km: '', last_service_date: '', last_service_odometer: '', is_active: true },
  })
  const chosen = vehicles.data?.results.find((v) => String(v.id) === watch('vehicle')) ?? vehicle

  const save = useMutation({
    mutationFn: (body) => (isNew ? api.post('/maintenance-schedules/', body) : api.patch(`/maintenance-schedules/${schedule.id}/`, body)),
    onSuccess: () => {
      invalidatePrefix(qc, '/maintenance-schedules/')
      toast(isNew ? 'Preventive schedule added.' : 'Schedule updated.')
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => save.mutate({
    vehicle: Number(v.vehicle), category: Number(v.category), interval_days: orNull(v.interval_days), interval_km: orNull(v.interval_km),
    last_service_date: v.last_service_date || null, last_service_odometer: orNull(v.last_service_odometer), is_active: v.is_active,
  })

  const text = (name, label, { hint, ...props } = {}) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message} hint={hint}>
      <input id={name} className={inputClass} {...register(name)} {...props} />
    </Field>
  )

  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}
      {vehicle || schedule ? (
        <div>
          <span className="mb-1 block text-sm font-medium">Vehicle</span>
          <input type="hidden" {...register('vehicle')} />
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{(vehicle ?? schedule).plate_number}</div>
        </div>
      ) : (
        <Field label="Vehicle *" htmlFor="vehicle" error={errors.vehicle?.message}>
          <select id="vehicle" className={inputClass} {...register('vehicle')}>
            <option value="">Select a vehicle…</option>
            {vehicles.data?.results.map((v) => <option key={v.id} value={v.id}>{v.plate_number} · {v.make} {v.model}</option>)}
          </select>
        </Field>
      )}
      <Field label="Category *" htmlFor="category" error={errors.category?.message}>
        <select id="category" className={inputClass} disabled={!isNew} {...register('category')}>
          <option value="">Select…</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      <fieldset className="grid gap-4 rounded-md border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-brand">Service interval <span className="font-normal text-slate-500">· due when either is reached</span></legend>
        {text('interval_days', 'Every … days', { inputMode: 'numeric', placeholder: 'e.g. 180' })}
        {text('interval_km', 'Every … km', { inputMode: 'numeric', placeholder: 'e.g. 5000' })}
      </fieldset>
      <fieldset className="grid gap-4 rounded-md border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-brand">Last service <span className="font-normal text-slate-500">· starting point (optional)</span></legend>
        {text('last_service_date', 'Date', { type: 'date', hint: 'Updated automatically when a matching job is completed.' })}
        {text('last_service_odometer', 'Odometer (km)', { inputMode: 'numeric', hint: chosen?.current_odometer != null ? `Vehicle is at ${formatKm(chosen.current_odometer)}.` : undefined })}
      </fieldset>
      {!isNew && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" {...register('is_active')} /> Active</label>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save schedule'}</Button>
      </div>
    </form>
  )
}
