import { Badge } from '../../components/ui'

// Mirrors operations.models.RFIDAccount.Provider.
export const PROVIDERS = [['EASYTRIP', 'Easytrip'], ['AUTOSWEEP', 'Autosweep'], ['OTHER', 'Other']]
export const providerLabel = Object.fromEntries(PROVIDERS)
const tone = { EASYTRIP: 'blue', AUTOSWEEP: 'gold', OTHER: 'gray' }

export const ProviderBadge = ({ provider }) => <Badge tone={tone[provider] ?? 'gray'}>{providerLabel[provider] ?? provider}</Badge>

/** A toll transaction is a load (credit) or a charge (debit). */
export const isLoad = (t) => Number(t.credit) > 0
