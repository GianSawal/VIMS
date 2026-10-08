import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, errorMessage } from '../../api'
import { useCan } from '../../auth'
import { Button, Field, inputClass, PageHeader } from '../../components/ui'
import { useToast } from '../../components/toast'
import { Forbidden } from '../Errors'
import { useAllOffices } from '../admin/Offices'
import { FUELS, STATUSES, TYPES } from './common'

const optionalNumber = (msg) => z.string().trim().refine((v) => v === '' || (!isNaN(v) && Number(v) >= 0), msg)

const schema = z.object({
  plate_number: z.string().trim().min(1, 'Plate number is required').max(20),
  property_number: z.string().max(50),
  make: z.string().trim().min(1, 'Make is required').max(50),
  model: z.string().trim().min(1, 'Model is required').max(50),
  variant: z.string().max(50),
  year_model: z.string().trim().refine((v) => v === '' || /^(19[5-9]\d|20\d\d)$/.test(v), 'Enter a 4-digit year'),
  vehicle_type: z.string().min(1, 'Select a type'),
  color: z.string().max(30),
  engine_number: z.string().max(50),
  chassis_number: z.string().max(50),
  fuel_type: z.string().min(1, 'Select a fuel type'),
  acquisition_date: z.string(),
  acquisition_cost: optionalNumber('Enter a non-negative amount'),
  current_odometer: z.string().trim().refine((v) => /^\d+$/.test(v), 'Enter the odometer in whole km'),
  office: z.string().min(1, 'Select an office'),
  status: z.string().min(1),
  remarks: z.string(),
})
const FIELDS = Object.keys(schema.shape)

const toForm = (v) => Object.fromEntries(FIELDS.map((k) => [k, v?.[k] == null ? '' : String(v[k])]))

function toPayload(values) {
  const nullable = ['property_number', 'engine_number', 'chassis_number', 'year_model', 'acquisition_date', 'acquisition_cost']
  const out = { ...values, office: Number(values.office), current_odometer: Number(values.current_odometer) }
  for (const k of nullable) if (out[k] === '') out[k] = null
  if (out.year_model) out.year_model = Number(out.year_model)
  return out
}

export default function VehicleForm() {
  const { id } = useParams()
  const can = useCan()
  const vehicle = useQuery({
    queryKey: ['/vehicles/', id],
    queryFn: () => api.get(`/vehicles/${id}/`).then((r) => r.data),
    enabled: !!id,
  })

  if (!can(id ? 'fleet.change_vehicle' : 'fleet.add_vehicle')) return <Forbidden />
  if (id && vehicle.isLoading) return <div className="text-slate-500">Loading…</div>
  if (id && vehicle.isError) return <div className="text-danger">{errorMessage(vehicle.error)}</div>
  return <VehicleFormBody key={id ?? 'new'} vehicle={vehicle.data} />
}

function VehicleFormBody({ vehicle }) {
  const isNew = !vehicle
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const offices = useAllOffices()
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: isNew ? { ...toForm(null), status: 'SERVICEABLE', current_odometer: '0' } : toForm(vehicle),
  })

  const save = useMutation({
    mutationFn: (body) => isNew ? api.post('/vehicles/', body) : api.patch(`/vehicles/${vehicle.id}/`, body),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ['/vehicles/'] })
      toast(isNew ? `Vehicle ${data.plate_number} added.` : 'Vehicle updated.')
      navigate(`/vehicles/${data.id}`)
    },
    onError: (err) => {
      setFormError(applyFieldErrors(err, setError, FIELDS))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
  })

  const text = (name, label, { hint, ...props } = {}) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message} hint={hint}>
      <input id={name} className={inputClass} {...register(name)} {...props} />
    </Field>
  )
  const select = (name, label, options, placeholder = 'Select…') => (
    <Field label={label} htmlFor={name} error={errors[name]?.message}>
      <select id={name} className={inputClass} {...register(name)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  )

  return (
    <div className="max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/vehicles" className="hover:underline">Vehicles</Link>
        {!isNew && <> / <Link to={`/vehicles/${vehicle.id}`} className="hover:underline">{vehicle.plate_number}</Link></>}
        {' / '}<span aria-current="page">{isNew ? 'Add' : 'Edit'}</span>
      </nav>
      <PageHeader title={isNew ? 'Add Vehicle' : `Edit ${vehicle.plate_number}`} />

      <form noValidate onSubmit={handleSubmit((v) => save.mutate(toPayload(v)))} className="space-y-6">
        {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}

        <Section title="Identification">
          {text('plate_number', 'Plate number *', { autoFocus: isNew, className: `${inputClass} uppercase` })}
          {text('property_number', 'Property number')}
          {text('engine_number', 'Engine number', { className: `${inputClass} uppercase` })}
          {text('chassis_number', 'Chassis number', { className: `${inputClass} uppercase` })}
        </Section>

        <Section title="Description">
          {text('make', 'Make *', { placeholder: 'Toyota' })}
          {text('model', 'Model *', { placeholder: 'Innova' })}
          {text('variant', 'Variant', { placeholder: '2.8 E AT' })}
          {text('year_model', 'Year model', { inputMode: 'numeric', placeholder: '2022' })}
          {select('vehicle_type', 'Vehicle type *', TYPES)}
          {select('fuel_type', 'Fuel type *', FUELS)}
          {text('color', 'Color')}
        </Section>

        <Section title="Acquisition">
          {text('acquisition_date', 'Acquisition date', { type: 'date' })}
          {text('acquisition_cost', 'Acquisition cost (₱)', { inputMode: 'decimal', placeholder: '0.00' })}
        </Section>

        <Section title="Status and assignment">
          {select('office', 'Owning office *', (offices.data?.results ?? []).filter((o) => o.is_active).map((o) => [String(o.id), `${o.code} - ${o.name}`]))}
          {select('status', 'Status *', STATUSES.map(([v, l]) => [v, l]), null)}
          {text('current_odometer', 'Current odometer (km) *', {
            inputMode: 'numeric',
            hint: isNew ? undefined : 'Cannot be lowered without an authorized correction.',
          })}
        </Section>

        <Section title="Remarks" cols={1}>
          <Field label="Remarks" htmlFor="remarks" error={errors.remarks?.message}>
            <textarea id="remarks" rows={3} className={inputClass} {...register('remarks')} />
          </Field>
        </Section>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(isNew ? '/vehicles' : `/vehicles/${vehicle.id}`)}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : isNew ? 'Add vehicle' : 'Save changes'}</Button>
        </div>
      </form>
    </div>
  )
}

function Section({ title, children, cols = 2 }) {
  return (
    <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
      <legend className="px-1 text-sm font-semibold text-brand">{title}</legend>
      <div className={`grid gap-4 ${cols === 2 ? 'sm:grid-cols-2' : ''}`}>{children}</div>
    </fieldset>
  )
}
