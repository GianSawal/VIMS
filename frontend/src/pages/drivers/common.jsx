import { Badge } from '../../components/ui'

export const LICENSE_TYPES = [['PROFESSIONAL', 'Professional'], ['NON_PROFESSIONAL', 'Non-Professional']]

export const LICENSE_STATUSES = [['VALID', 'Valid'], ['EXPIRING', 'Expiring soon'], ['EXPIRED', 'Expired']]
const tone = { VALID: 'green', EXPIRING: 'gold', EXPIRED: 'red' }
const label = Object.fromEntries(LICENSE_STATUSES)

export const LicenseBadge = ({ status }) => <Badge tone={tone[status]} dot>{label[status]}</Badge>

export const formatBytes = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`)

// Local-time YYYY-MM-DD for <input type="date"> (toISOString would give the UTC date).
export const todayISO = () => new Date().toLocaleDateString('en-CA')

// "expired 3 days ago" / "expires today" / "in 12 days" for a license expiry date (YYYY-MM-DD).
export function expiryNote(dateStr) {
  const days = Math.round((new Date(dateStr) - new Date(todayISO())) / 86400000)
  const plural = (n) => `${n} day${n === 1 ? '' : 's'}`
  if (days < 0) return `expired ${plural(-days)} ago`
  return days === 0 ? 'expires today' : `in ${plural(days)}`
}
