import { Badge } from '../../components/ui'

// Mirrors fleet.models.VehicleDocument.Type; `expires` = needs an expiry date (fleet/documents.py EXPIRING_TYPES).
export const DOC_TYPES = [
  ['LTO_REGISTRATION', 'LTO Registration', true],
  ['OR', 'Official Receipt (OR)', true],
  ['CR', 'Certificate of Registration (CR)', false],
  ['GSIS_INSURANCE', 'GSIS Insurance', true],
  ['INSURANCE_POLICY', 'Insurance Policy', true],
  ['DEED', 'Deed / Property Record', false],
  ['INSPECTION', 'Inspection Record', false],
  ['OTHER', 'Other', false],
]
export const typeLabel = Object.fromEntries(DOC_TYPES.map(([k, l]) => [k, l]))
export const needsExpiry = (type) => DOC_TYPES.some(([k, , e]) => k === type && e)

// Quick type groups for the list page (LTO, OR/CR, GSIS/insurance).
export const TYPE_GROUPS = [
  ['', 'All types'],
  ['LTO_REGISTRATION', 'LTO registration'],
  ['OR,CR', 'OR / CR'],
  ['GSIS_INSURANCE,INSURANCE_POLICY', 'GSIS / insurance'],
  ['DEED,INSPECTION,OTHER', 'Other records'],
]

/** Expiry bands from the API (fleet/documents.py): label and badge tone. */
export const BANDS = {
  EXPIRED: ['Expired', 'red'],
  7: ['Within 7 days', 'red'],
  15: ['Within 15 days', 'gold'],
  30: ['Within 30 days', 'gold'],
  60: ['Within 60 days', 'blue'],
  VALID: ['Valid', 'green'],
  NONE: ['No expiry', 'gray'],
}

export const STATUS_TONE = { ACTIVE: 'green', SUPERSEDED: 'gray', CANCELLED: 'gray' }

/** Badge for a document: its expiry band when current, else its status (Superseded / Cancelled). */
export function DocBadge({ doc }) {
  if (!doc.expiry) return <Badge tone={STATUS_TONE[doc.status]}>{doc.status === 'SUPERSEDED' ? 'Renewed' : doc.status_display}</Badge>
  const [label, tone] = BANDS[doc.expiry.band]
  return <Badge tone={tone} dot>{doc.expiry.band === 'EXPIRED' ? 'Expired' : doc.expiry.band === 'VALID' ? 'Valid' : doc.expiry.band === 'NONE' ? label : 'Expiring'}</Badge>
}

/** "Expires in 12 days" / "Expires today" / "Expired 3 days ago" for a current document. */
export function daysText(expiry) {
  if (!expiry || expiry.days_left == null) return null
  const d = expiry.days_left
  if (d < 0) return `Expired ${-d} day${d === -1 ? '' : 's'} ago`
  if (d === 0) return 'Expires today'
  return `Expires in ${d} day${d === 1 ? '' : 's'}`
}
