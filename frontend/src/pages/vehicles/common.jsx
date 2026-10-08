import { Car } from 'lucide-react'
import { Badge } from '../../components/ui'

// Mirrors fleet.models.Vehicle choices.
export const STATUSES = [
  ['SERVICEABLE', 'Serviceable', 'green'],
  ['IN_USE', 'In Use', 'blue'],
  ['UNDER_MAINTENANCE', 'Under Maintenance', 'gold'],
  ['FOR_REPAIR', 'For Repair', 'gold'],
  ['UNSERVICEABLE', 'Unserviceable', 'red'],
  ['DISPOSED', 'Disposed', 'gray'],
]
export const TYPES = [
  ['SEDAN', 'Sedan'], ['SUV', 'SUV'], ['VAN', 'Van'], ['PICKUP', 'Pickup'], ['BUS', 'Bus'],
  ['TRUCK', 'Truck'], ['MOTORCYCLE', 'Motorcycle'], ['OTHER', 'Other'],
]
export const FUELS = [['GASOLINE', 'Gasoline'], ['DIESEL', 'Diesel'], ['HYBRID', 'Hybrid'], ['ELECTRIC', 'Electric'], ['OTHER', 'Other']]

const statusTone = Object.fromEntries(STATUSES.map(([v, , t]) => [v, t]))
export const fuelLabel = Object.fromEntries(FUELS)

export function StatusBadge({ vehicle }) {
  if (vehicle.is_archived) return <Badge tone="gray" dot>Archived</Badge>
  return <Badge tone={statusTone[vehicle.status]} dot>{vehicle.status_display}</Badge>
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const num = new Intl.NumberFormat('en-PH')
export const formatPeso = (v) => (v == null || v === '' ? '—' : peso.format(v))
export const formatKm = (v) => (v == null ? '—' : `${num.format(v)} km`)
export const formatDate = (v) => (v ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(new Date(v)) : '—')

// Photo or a neutral placeholder; fixed 4:3 box so layouts don't jump. object-contain = whole photo visible, never cropped.
export function VehiclePhoto({ vehicle, className = '' }) {
  const alt = `Photo of ${vehicle.make} ${vehicle.model} (${vehicle.plate_number})`
  return (
    <div className={`aspect-[4/3] overflow-hidden rounded-md ${vehicle.photo_url ? 'bg-white' : 'bg-slate-100'} ${className}`}>
      {vehicle.photo_url
        ? <img src={vehicle.photo_url} alt={alt} className="h-full w-full object-contain" loading="lazy" />
        : (
          <div className="flex h-full w-full items-center justify-center text-slate-400" role="img" aria-label="No photo">
            <Car className="h-1/2 w-1/2" strokeWidth={1.25} aria-hidden="true" />
          </div>
        )}
    </div>
  )
}

// "3 days", "5 months", "2 years"; same-day stints read "Same day". `end` defaults to today.
export function duration(startDate, endDate) {
  const end = endDate ? new Date(endDate) : new Date(new Date().toLocaleDateString('en-CA'))
  const days = Math.round((end - new Date(startDate)) / 86400000)
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (days < 1) return 'Same day'
  if (days < 60) return plural(days, 'day')
  if (days < 730) return plural(Math.round(days / 30), 'month')
  return plural(Math.round(days / 365), 'year')
}
