import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, Navigation } from 'lucide-react'
import { api, errorMessage } from '../api'
import { Button } from './ui'
import { mapsLink } from './PlaceSearch'

export const durationText = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim())
const km = (v) => Number(v).toLocaleString('en-PH', { maximumFractionDigits: 1 })

/**
 * Google driving estimate between two places. Runs by itself when both were picked from suggestions;
 * typed-only places get an "Estimate distance" button (saves API calls). onEstimate(est | null).
 */
export default function RouteEstimate({ origin, destination, enabled, onEstimate }) {
  const both = origin.text.trim() && destination.text.trim()
  const picked = origin.place_id && destination.place_id
  const key = `${origin.place_id ?? origin.text}|${destination.place_id ?? destination.text}`
  // A result belongs to the places it was computed for; once either place changes it simply stops showing.
  const [result, setResult] = useState(null) // { key, data } | { key, error }
  const [loadingKey, setLoadingKey] = useState(null)
  const est = result?.key === key ? result.data : null
  const error = result?.key === key ? result.error : ''
  const loading = loadingKey === key

  const run = () => {
    setLoadingKey(key)
    const point = (p) => (p.place_id ? { place_id: p.place_id } : { address: p.text })
    api.post('/maps/route/', { origin: point(origin), destination: point(destination) })
      .then((r) => { setResult({ key, data: r.data }); onEstimate(r.data) })
      .catch((e) => { setResult({ key, error: errorMessage(e) }); onEstimate(null) })
      .finally(() => setLoadingKey(null))
  }

  // Both places picked from suggestions: estimate automatically.
  useEffect(() => {
    if (!enabled || !picked) return undefined
    const t = setTimeout(run, 300)
    return () => clearTimeout(t)
  }, [key, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!both) return null
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/20 bg-brand-light/50 px-4 py-3 text-sm sm:col-span-2" aria-live="polite">
      <Navigation size={18} className="shrink-0 text-brand" aria-hidden="true" />
      <div className="mr-auto min-w-0">
        {loading && <span className="inline-flex items-center gap-2 text-slate-600"><Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" /> Getting the driving distance…</span>}
        {!loading && est && (
          <>
            <div><strong className="text-base text-brand">≈ {km(est.distance_km)} km</strong> one way · <strong>≈ {km(est.distance_km * 2)} km</strong> round trip</div>
            <div className="text-xs text-slate-500">About {durationText(est.duration_min)} by car each way, without traffic. Google Maps estimate; the odometer is the official record.</div>
          </>
        )}
        {!loading && !est && error && <span className="text-amber-800">{error}</span>}
        {!loading && !est && !error && (enabled
          ? <span className="text-slate-600">{picked ? '' : 'Pick both places from the suggestions for an automatic estimate, or'}</span>
          : <span className="text-slate-600">Distance estimates need Google Maps to be set up. You can still check the route:</span>)}
      </div>
      {enabled && !est && !loading && !picked && <Button variant="secondary" onClick={run}>Estimate distance</Button>}
      <a href={mapsLink(origin, destination)} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
        Open in Google Maps <ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  )
}
