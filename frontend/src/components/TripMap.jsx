import { useEffect } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PROVIDER_NAME, useMapsStatus } from './PlaceSearch'

// Pins drawn as inline SVG (Leaflet's default PNG markers break under Vite and don't match the theme).
const pin = (color, letter) => L.divIcon({
  className: '',
  html: `<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39s13-13.2 13-24A13 13 0 0 0 2 15c0 10.8 13 24 13 24z" fill="${color}" stroke="#fff" stroke-width="2"/><text x="15" y="20" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="system-ui">${letter}</text></svg>`,
  iconSize: [30, 40],
  iconAnchor: [15, 39],
  tooltipAnchor: [0, -36],
})
const ORIGIN_PIN = pin('#0305ba', 'A')        // brand blue
const DESTINATION_PIN = pin('#c40002', 'B')   // danger red (readable on map tiles)
const ROUTE_COLOR = '#2b31e0'                 // --color-chart

function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [30, 30] })
    else if (points.length === 1) map.setView(points[0], 14)
  }, [map, points])
  return null
}

/**
 * Driving route on an OpenStreetMap base map.
 * origin/destination: [lat, lng] or null; route: [[lat, lng], ...] or null; labels for the pin tooltips.
 */
export default function TripMap({ origin, destination, route, originLabel, destinationLabel, className = 'h-64 sm:h-80' }) {
  const { provider } = useMapsStatus()
  const links = { locationiq: 'https://locationiq.com/', geoapify: 'https://www.geoapify.com/' }
  const credit = provider ? ` | Routing <a href="${links[provider]}">${PROVIDER_NAME[provider]}</a>` : ''
  const points = route?.length ? route : [origin, destination].filter(Boolean)
  const center = points[0] ?? [15.03, 120.69] // Region III fallback
  return (
    <div className={`relative z-0 overflow-hidden rounded-lg border border-slate-200 ${className}`}
      role="region" aria-label={`Map of the route from ${originLabel ?? 'origin'} to ${destinationLabel ?? 'destination'}`}>
      <MapContainer center={center} zoom={11} scrollWheelZoom={false} className="h-full w-full">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution={`&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors${credit}`} />
        {route?.length > 1 && <Polyline positions={route} pathOptions={{ color: ROUTE_COLOR, weight: 5, opacity: 0.85 }} />}
        {origin && <Marker position={origin} icon={ORIGIN_PIN}><Tooltip>From: {originLabel}</Tooltip></Marker>}
        {destination && <Marker position={destination} icon={DESTINATION_PIN}><Tooltip>To: {destinationLabel}</Tooltip></Marker>}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  )
}
