import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors, invalidatePrefix } from '../../api'
import { useMe } from '../../auth'
import { Button, Field, inputClass } from '../../components/ui'
import { useToast } from '../../components/toast'
import PlaceSearch, { EMPTY_PLACE, MapSwitch, useMapsEnabled } from '../../components/PlaceSearch'
import RouteEstimate from '../../components/RouteEstimate'
import { fromLocalInput, toLocalInput } from '../trips/common'

const schema = z.object({
  office: z.string().min(1, 'Select your office'),
  needed_at: z.string().min(1, 'Choose the date and time you need the vehicle'),
  return_at: z.string(),
  origin: z.string().trim().min(1, 'Origin is required').max(200),
  destination: z.string().trim().min(1, 'Destination is required').max(255),
  purpose: z.string().trim().min(1, 'Purpose is required'),
  passengers: z.string(),
  remarks: z.string(),
}).refine((v) => !v.return_at || v.return_at >= v.needed_at, { path: ['return_at'], message: 'Expected return cannot be before the departure' })
const FIELDS = Object.keys(schema.shape)

const tomorrowAt8 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return toLocalInput(d) }

/** New vehicle request. On success the caller opens the request (to attach the travel order there). */
export default function RequestForm({ onClose, onSaved }) {
  const { data: me } = useMe()
  const offices = me?.offices ?? []
  const qc = useQueryClient()
  const toast = useToast()
  const mapsAvailable = useMapsEnabled()
  const [useMap, setUseMap] = useState(true) // the requester can skip the map and type places as plain text
  const mapsOn = mapsAvailable && useMap
  const toggleMap = (on) => {
    setUseMap(on)
    setEstimate(null) // nothing from the map is saved when it is off
    setOrigin((p) => ({ ...EMPTY_PLACE, text: p.text }))
    setDest((p) => ({ ...EMPTY_PLACE, text: p.text }))
  }
  const [origin, setOrigin] = useState(EMPTY_PLACE)
  const [dest, setDest] = useState(EMPTY_PLACE)
  const [estimate, setEstimate] = useState(null)
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { ...Object.fromEntries(FIELDS.map((k) => [k, ''])), office: offices.length === 1 ? String(offices[0].id) : '', needed_at: tomorrowAt8() },
  })

  const save = useMutation({
    mutationFn: (body) => api.post('/vehicle-requests/', body),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/vehicle-requests/')
      toast(`Request ${data.reference_number} sent. You will be notified when it is approved or declined.`)
      onSaved?.(data)
      onClose()
    },
    onError: (err) => setFormError(applyFieldErrors(err, setError, FIELDS)),
  })

  const submit = (v) => save.mutate({
    ...v,
    office: Number(v.office),
    needed_at: fromLocalInput(v.needed_at),
    return_at: v.return_at ? fromLocalInput(v.return_at) : null,
    estimated_distance_km: estimate ? String(estimate.distance_km) : null,
    estimated_duration_min: estimate ? estimate.duration_min : null,
    origin_lat: estimate ? estimate.origin[0].toFixed(6) : null,
    origin_lng: estimate ? estimate.origin[1].toFixed(6) : null,
    destination_lat: estimate ? estimate.destination[0].toFixed(6) : null,
    destination_lng: estimate ? estimate.destination[1].toFixed(6) : null,
    route_geometry: estimate ? estimate.geometry : null,
  })

  const input = (name, label, { hint, ...props } = {}) => (
    <Field label={label} htmlFor={name} error={errors[name]?.message} hint={hint}>
      <input id={name} className={inputClass} {...register(name)} {...props} />
    </Field>
  )

  return (
    <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)}>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger sm:col-span-2">{error}</div>}

      {offices.length === 1 ? <input type="hidden" {...register('office')} /> : (
        <div className="sm:col-span-2">
          <Field label="Requesting office *" htmlFor="office" error={errors.office?.message}>
            <select id="office" className={inputClass} {...register('office')}>
              <option value="">Select your office…</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.code} - {o.name}</option>)}
            </select>
          </Field>
        </div>
      )}

      {input('needed_at', 'Date and time needed *', { type: 'datetime-local', min: toLocalInput() })}
      {input('return_at', 'Expected return', { type: 'datetime-local', hint: 'Optional, but helps the fleet plan the day.' })}

      <input type="hidden" {...register('origin')} />
      <input type="hidden" {...register('destination')} />
      {mapsAvailable && <MapSwitch on={useMap} onChange={toggleMap} className="sm:col-span-2" />}
      <Field label="Pick-up / origin *" htmlFor="origin-search" error={errors.origin?.message}>
        <PlaceSearch id="origin-search" value={origin} enabled={mapsOn} invalid={!!errors.origin}
          placeholder={mapsOn ? 'Search a place, e.g. DOLE Regional Office III' : 'e.g. DOLE Regional Office'}
          onChange={(p) => { setOrigin(p); setEstimate(null); setValue('origin', p.text, { shouldValidate: !!errors.origin }) }} />
      </Field>
      <Field label="Destination *" htmlFor="destination-search" error={errors.destination?.message}>
        <PlaceSearch id="destination-search" value={dest} enabled={mapsOn} invalid={!!errors.destination}
          placeholder={mapsOn ? 'Search where you are going' : 'e.g. Provincial Office, Tarlac'}
          onChange={(p) => { setDest(p); setEstimate(null); setValue('destination', p.text, { shouldValidate: !!errors.destination }) }} />
      </Field>
      {mapsOn && <RouteEstimate origin={origin} destination={dest} enabled onEstimate={setEstimate} />}

      <div className="sm:col-span-2">
        <Field label="Purpose *" htmlFor="purpose" error={errors.purpose?.message}>
          <textarea id="purpose" rows={2} className={inputClass} placeholder="e.g. Labor inspection, TUPAD payout monitoring" {...register('purpose')} />
        </Field>
      </div>
      <Field label="Passengers" htmlFor="passengers" error={errors.passengers?.message}>
        <textarea id="passengers" rows={2} className={inputClass} placeholder="One name per line" {...register('passengers')} />
      </Field>
      <Field label="Remarks" htmlFor="remarks" error={errors.remarks?.message}>
        <textarea id="remarks" rows={2} className={inputClass} placeholder="Anything the fleet should know" {...register('remarks')} />
      </Field>
      <p className="text-xs text-slate-500 sm:col-span-2">You can attach the travel order on the next page.</p>

      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Sending…' : 'Send request'}</Button>
      </div>
    </form>
  )
}
