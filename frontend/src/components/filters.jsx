import { Search, X } from 'lucide-react'
import { inputBase } from './ui'

// Compact control for filter bars (no w-full: callers set their own width).
export const selectClass = `${inputBase} h-9 py-0`

// "Atty. SARAH BUENA S. MIRASOL" -> "SM": skips titles/initials that end with a period.
export const initials = (name) =>
  name.split(/\s+/).filter((w) => w && !w.endsWith('.')).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

export function Avatar({ name, className = '' }) {
  return (
    <span aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-light text-sm font-semibold text-brand ${className}`}>
      {initials(name)}
    </span>
  )
}

/** Clickable count card used as a filter (aria-pressed). `tint` = icon background/text classes. */
export function StatCard({ icon: Icon, tint, label, count, loading, selected, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={`flex items-center gap-3 rounded-xl border bg-white px-3 py-3 text-left shadow-sm transition hover:shadow-md ${
        selected ? 'border-brand ring-1 ring-brand' : 'border-slate-200 hover:border-slate-300'}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        {loading
          ? <span className="block h-6 w-8 animate-pulse rounded bg-slate-200" />
          : <span className="block text-xl leading-none font-semibold text-ink tabular-nums">{count ?? 0}</span>}
        <span className="mt-1 block truncate text-xs text-slate-500">{label}</span>
      </span>
    </button>
  )
}

export function CardGrid({ label = 'Filter', children }) {
  return <div role="group" aria-label={label} className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">{children}</div>
}

export function SearchBox({ id, label, placeholder, value, onChange }) {
  return (
    <div className="relative w-full sm:w-80">
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search size={16} className="absolute top-2.5 left-3 text-slate-400" aria-hidden="true" />
      <input id={id} type="search" className={`${selectClass} w-full pl-9`} placeholder={placeholder}
        value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

/** Toolbar attached to the top of a DataTable card. chips: [[key, text]]. */
export function Toolbar({ children, chips = [], onRemove, onClear }) {
  return (
    <div className="border-b border-slate-200">
      <div className="flex flex-wrap items-center gap-2 p-3">{children}</div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2">
          <span className="text-xs text-slate-500">Filtered by</span>
          {chips.map(([key, text]) => (
            <button key={key} type="button" onClick={() => onRemove(key)} aria-label={`Remove filter ${text}`}
              className="inline-flex items-center gap-1 rounded-md border border-brand/20 bg-white px-2 py-1 text-xs font-medium text-brand hover:bg-brand-light">
              {text} <X size={12} aria-hidden="true" />
            </button>
          ))}
          <button type="button" onClick={onClear} className="ml-auto text-xs font-medium text-brand hover:underline">Clear all</button>
        </div>
      )}
    </div>
  )
}
