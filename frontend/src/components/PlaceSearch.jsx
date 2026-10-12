import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, MapPin } from 'lucide-react'
import { api, errorMessage } from '../api'
import { inputClass } from './ui'

/** Is the server-side map service configured? (GEOAPIFY_API_KEY in backend/.env) */
export function useMapsEnabled() {
  const q = useQuery({
    queryKey: ['/maps/status/'],
    queryFn: () => api.get('/maps/status/').then((r) => r.data.enabled),
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
  return q.data === true
}

/** OpenStreetMap directions link (free, no key). Uses coordinates when known, else a search for the text. */
export function mapsLink(origin, destination) {
  if (origin.lat != null && destination.lat != null) {
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${origin.lat},${origin.lon};${destination.lat},${destination.lon}`
  }
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(destination.text)}`
}

export const EMPTY_PLACE = { text: '', place_id: null, lat: null, lon: null }

/**
 * Text input with place suggestions (Geoapify, Philippines). Works as a plain input when maps are off.
 * value: { text, place_id, lat, lon }  onChange(next value)
 */
export default function PlaceSearch({ id, value, onChange, enabled, placeholder, invalid, describedBy }) {
  const listId = useId()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const typed = useRef(false)

  useEffect(() => {
    const q = value.text.trim()
    if (!enabled || !typed.current || value.place_id || q.length < 3) return undefined
    const t = setTimeout(() => {
      setLoading(true)
      api.get('/maps/autocomplete/', { params: { q } })
        .then((r) => { setItems(r.data.results); setOpen(true); setActive(-1); setError('') })
        .catch((e) => { setItems([]); setError(errorMessage(e)) })
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [value.text, value.place_id, enabled])

  const pick = (it) => {
    typed.current = false
    onChange({ text: [it.main, it.secondary].filter(Boolean).join(', '), place_id: it.place_id, lat: it.lat, lon: it.lon })
    setOpen(false)
    setItems([])
  }

  const onKeyDown = (e) => {
    if (!open || !items.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)) }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative">
      <MapPin size={16} className={`absolute top-2.5 left-3 ${value.place_id ? 'text-brand' : 'text-slate-400'}`} aria-hidden="true" />
      <input id={id} className={`${inputClass} pl-9 ${invalid ? 'border-danger' : ''}`} placeholder={placeholder} autoComplete="off"
        value={value.text} onKeyDown={onKeyDown} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { typed.current = true; onChange({ text: e.target.value, place_id: null, lat: null, lon: null }) }}
        role={enabled ? 'combobox' : undefined} aria-expanded={enabled ? open : undefined} aria-controls={enabled ? listId : undefined}
        aria-autocomplete={enabled ? 'list' : undefined} aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined} aria-describedby={describedBy} />
      {loading && <Loader2 size={16} className="absolute top-2.5 right-3 text-slate-400 motion-safe:animate-spin" aria-hidden="true" />}
      {enabled && open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No places found. You can keep the typed text.</li>}
          {items.map((it, i) => (
            <li key={it.place_id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(it) }}
              className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${i === active ? 'bg-brand-light' : 'hover:bg-slate-50'}`}>
              <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
              <span><span className="block font-medium text-ink">{it.main}</span><span className="block text-xs text-slate-500">{it.secondary}</span></span>
            </li>
          ))}
          <li className="px-3 pt-1 text-right text-[10px] text-slate-400" aria-hidden="true">Powered by Geoapify</li>
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-amber-700">{error}</p>}
    </div>
  )
}
