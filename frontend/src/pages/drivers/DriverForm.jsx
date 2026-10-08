import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, invalidatePrefix } from '../../api'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import { useAllOffices } from '../admin/Offices'
import { LICENSE_TYPES } from './common'

const schema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(150),
  employee_number: z.string().max(30),
  office: z.string().min(1, 'Select an office'),
  contact_number: z.string().max(30),
  license_number: z.string().trim().min(1, 'License number is required').max(30),
  license_type: z.string().min(1, 'Select a license type'),
  license_restrictions: z.string().max(50),
  license_issue_date: z.string(),
  license_expiry_date: z.string().min(1, 'Expiry date is required'),
  is_active: z.boolean(),
})
const FIELDS = Object.keys(schema.shape)

/** Modal body for adding (driver = {}) or editing a driver. */
export default function DriverForm({ driver, onClose, onSaved }) {
  const isNew = !driver.id
  const qc = useQueryClient()
  const toast = useToast()
  const offices = useAllOffices()
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      ...Object.fromEntries(FIELDS.map((k) => [k, driver[k] == null ? '' : String(driver[k])])),
      office: driver.office ? String(driver.office) : '',
      is_active: driver.is_active ?? true,
    },
  })

  const save = useMutation({
    mutationFn: (body) => isNew ? api.post('/drivers/', body) : api.patch(`/drivers/${driver.id}/`, body),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/drivers/')
      toast(isNew ? `Driver ${data.full_name} added.` : 'Driver updated.')
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => save.mutate({
    ...v,
    office: Number(v.office),
    employee_number: v.employee_number || null,
    license_issue_date: v.license_issue_date || null,
  })

  const text = (name, label, props = {}) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message}>
      <input id={name} className={inputClass} {...register(name)} {...props} />
    </Field>
  )

  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}
      <div className="sm:col-span-2">{text('full_name', 'Full name *', { autoFocus: isNew })}</div>
      {text('employee_number', 'Employee number')}
      <Field label="Office *" htmlFor="office" error={errors.office?.message}>
        <select id="office" className={inputClass} {...register('office')}>
          <option value="">Select…</option>
          {offices.data?.results.filter((o) => o.is_active || o.id === driver.office).map((o) => (
            <option key={o.id} value={o.id}>{o.code} - {o.name}</option>
          ))}
        </select>
      </Field>
      {text('contact_number', 'Contact number', { inputMode: 'tel' })}
      <div />
      <fieldset className="grid gap-4 rounded-md border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-brand">Driver&apos;s license</legend>
        {text('license_number', 'License number *', { className: `${inputClass} uppercase` })}
        <Field label="License type *" htmlFor="license_type" error={errors.license_type?.message}>
          <select id="license_type" className={inputClass} {...register('license_type')}>
            <option value="">Select…</option>
            {LICENSE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {text('license_restrictions', 'Restrictions', { placeholder: 'A, B, B1' })}
        <div />
        {text('license_issue_date', 'Issue date', { type: 'date' })}
        {text('license_expiry_date', 'Expiry date *', { type: 'date' })}
      </fieldset>
      {!isNew && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register('is_active')} /> Active
        </label>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )
}
