import { Badge } from '../../components/ui'

export const TRIP_STATUSES = [['DISPATCHED', 'On trip', 'blue'], ['COMPLETED', 'Completed', 'green'], ['CANCELLED', 'Cancelled', 'gray']]
const tone = Object.fromEntries(TRIP_STATUSES.map(([v, , t]) => [v, t]))
export const tripStatusLabel = Object.fromEntries(TRIP_STATUSES.map(([v, l]) => [v, l]))

export const TripStatusBadge = ({ status }) => <Badge tone={tone[status]} dot>{tripStatusLabel[status]}</Badge>

const pad = (n) => String(n).padStart(2, '0')
// Local 'YYYY-MM-DDTHH:mm' for <input type="datetime-local">.
export const toLocalInput = (value = new Date()) => {
  const d = new Date(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
// datetime-local value -> ISO with the browser's offset, so the server stores the right instant.
export const fromLocalInput = (value) => new Date(value).toISOString()

export function tripDuration(from, to) {
  const mins = Math.round((new Date(to ?? Date.now()) - new Date(from)) / 60000)
  if (mins < 60) return `${Math.max(mins, 0)} min`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h} h ${mins % 60} min`
  return `${Math.round(h / 24)} days`
}

const num = new Intl.NumberFormat('en-PH')
export const km = (v) => (v == null ? '—' : `${num.format(v)} km`)

const dt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
export const shortDateTime = (v) => (v ? dt.format(new Date(v)) : '—')
