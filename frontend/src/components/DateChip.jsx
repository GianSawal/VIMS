import { Link } from 'react-router-dom'

const dayNum = new Intl.DateTimeFormat('en-PH', { day: 'numeric' })
const monShort = new Intl.DateTimeFormat('en-PH', { month: 'short' })
const yearNum = new Intl.DateTimeFormat('en-PH', { year: 'numeric' })
const full = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long' })

/** Calendar-style date (month band, big day, year). `value` = Date, ISO date or datetime. Links when `to` is given. */
export default function DateChip({ value, to, muted = false }) {
  const d = typeof value === 'string' && value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value)
  const body = (
    <>
      <span className={`w-full py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase ${muted ? 'bg-slate-400' : 'bg-brand'}`}>{monShort.format(d)}</span>
      <span className="text-lg leading-tight font-bold text-ink tabular-nums">{dayNum.format(d)}</span>
      <span className="pb-0.5 text-[10px] text-slate-500">{yearNum.format(d)}</span>
    </>
  )
  const cls = 'flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-center shadow-sm'
  return to
    ? <Link to={to} onClick={(e) => e.stopPropagation()} aria-label={`Open record of ${full.format(d)}`} className={`${cls} hover:border-brand`}>{body}</Link>
    : <span className={cls} aria-label={full.format(d)}>{body}</span>
}
