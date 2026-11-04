import { Ban, CalendarCheck, CircleCheck, Hourglass, Navigation, XCircle } from 'lucide-react'
import { Badge } from '../../components/ui'

// [progress, label, badge tone, icon, card tint]. Progress = the request status, or its trip's once approved.
export const PROGRESS = [
  ['PENDING', 'Pending', 'gold', Hourglass, 'bg-amber-50 text-amber-700'],
  ['APPROVED', 'Approved', 'blue', CalendarCheck, 'bg-brand-light text-brand'],
  ['DISPATCHED', 'On trip', 'blue', Navigation, 'bg-brand-light text-brand'],
  ['COMPLETED', 'Completed', 'green', CircleCheck, 'bg-green-50 text-green-700'],
  ['DECLINED', 'Declined', 'red', XCircle, 'bg-red-50 text-danger'],
  ['CANCELLED', 'Cancelled', 'gray', Ban, 'bg-slate-100 text-slate-600'],
]
const byKey = Object.fromEntries(PROGRESS.map(([k, label, tone]) => [k, { label, tone }]))
export const progressLabel = (p) => byKey[p]?.label ?? p

export const ProgressBadge = ({ progress }) => <Badge tone={byKey[progress]?.tone} dot>{progressLabel(progress)}</Badge>

export const APPROVE = 'operations.approve_vehiclerequest'
