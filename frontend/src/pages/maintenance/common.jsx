import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { Badge } from '../../components/ui'

// Mirrors maintenance.models.MaintenanceRecord.Status (flow order).
export const FLOW = [
  ['SCHEDULED', 'Scheduled'], ['FOR_INSPECTION', 'For inspection'], ['IN_PROGRESS', 'In progress'], ['COMPLETED', 'Completed'],
]
export const STATUSES = [...FLOW, ['CANCELLED', 'Cancelled']]
const tone = { SCHEDULED: 'gray', FOR_INSPECTION: 'gold', IN_PROGRESS: 'blue', COMPLETED: 'green', CANCELLED: 'gray' }
export const statusLabel = Object.fromEntries(STATUSES)

export const MaintenanceStatusBadge = ({ status }) => <Badge tone={tone[status]} dot>{statusLabel[status]}</Badge>

export const DUE = {
  OVERDUE: ['Overdue', 'red'], DUE_SOON: ['Due soon', 'gold'], OK: ['On schedule', 'green'], NO_BASELINE: ['No last service', 'gray'],
}
export const DueBadge = ({ status }) => <Badge tone={DUE[status][1]} dot>{DUE[status][0]}</Badge>

const num = new Intl.NumberFormat('en-PH')

/** "20 days left" / "20 days overdue", "200 km left" / "100 km overdue" for the parts of a schedule that can be computed. */
export function dueParts(due) {
  const out = []
  if (due.days_left != null) out.push(due.days_left < 0 ? [`${-due.days_left} day${due.days_left === -1 ? '' : 's'} overdue`, true] : [due.days_left === 0 ? 'due today' : `${due.days_left} day${due.days_left === 1 ? '' : 's'} left`, false])
  if (due.km_left != null) out.push(due.km_left < 0 ? [`${num.format(-due.km_left)} km overdue`, true] : [`${num.format(due.km_left)} km left`, false])
  return out
}

export function intervalText(s) {
  const parts = []
  if (s.interval_days) parts.push(s.interval_days % 30 === 0 && s.interval_days >= 60 ? `${s.interval_days / 30} months` : `${s.interval_days} days`)
  if (s.interval_km) parts.push(`${num.format(s.interval_km)} km`)
  return `Every ${parts.join(' or ')}`
}

/** Active maintenance categories (an unpaginated reference list). */
export function useCategories({ includeInactive = false } = {}) {
  return useQuery({
    queryKey: ['/maintenance-categories/'],
    queryFn: () => api.get('/maintenance-categories/').then((r) => r.data),
    select: (rows) => (includeInactive ? rows : rows.filter((c) => c.is_active)),
    staleTime: 5 * 60 * 1000,
  })
}

export function CategoryChips({ names }) {
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n) => <span key={n} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">{n}</span>)}
    </div>
  )
}
