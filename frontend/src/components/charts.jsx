import { useState } from 'react'
import { Link } from 'react-router-dom'

/*
 * Small single-series charts in plain HTML/CSS (no chart library), following the dataviz skill:
 * one hue (--color-chart, validated), thin marks with 4px rounded data-ends on the baseline, recessive grid,
 * direct labels only on the latest and highest values, hover/focus tooltips, and a table view.
 */

// 0 -> nice round axis max with ~4 ticks (1, 2, 2.5, 5 x 10^n steps).
function niceScale(max, ticks = 4) {
  if (!max) return { top: 1, step: 0.25 }
  const raw = max / ticks
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)
  return { top: step * ticks, step }
}

const compact = new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * Vertical bars over time.
 * data: [{ key, label, value, tooltip: [lines] }]; format(value) -> string for labels and the table.
 */
export function TimeBars({ data, format, valueLabel, height = 'h-56' }) {
  const [table, setTable] = useState(false)
  const max = Math.max(0, ...data.map((d) => d.value))
  const { top, step } = niceScale(max)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const maxIndex = data.findIndex((d) => d.value === max && max > 0)
  const last = data.length - 1

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <div role="group" aria-label="Display" className="inline-flex rounded-md border border-slate-200 text-xs">
          {['Chart', 'Table'].map((m) => (
            <button key={m} type="button" aria-pressed={(m === 'Table') === table} onClick={() => setTable(m === 'Table')}
              className={`px-2.5 py-1 first:rounded-l-md last:rounded-r-md ${(m === 'Table') === table ? 'bg-slate-100 font-semibold text-ink' : 'text-slate-500 hover:text-ink'}`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left font-medium">Month</th><th className="py-1 text-right font-medium">{valueLabel}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[...data].reverse().map((d) => (
                <tr key={d.key}><td className="py-1.5">{d.label}</td><td className="py-1.5 text-right tabular-nums">{format(d.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          {/* y axis */}
          <div className={`relative w-12 shrink-0 ${height}`} aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums" style={{ bottom: `${(t / top) * 100}%` }}>
                {t === 0 ? '0' : `₱${compact.format(t)}`}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className={`relative ${height}`}>
              {ticks.map((t) => (
                <div key={t} aria-hidden="true" className={`absolute inset-x-0 border-t ${t === 0 ? 'border-slate-300' : 'border-dashed border-slate-200'}`} style={{ bottom: `${(t / top) * 100}%` }} />
              ))}
              <ol className="absolute inset-0 flex items-end gap-[2px]" aria-label={`${valueLabel} by month`}>
                {data.map((d, i) => {
                  const pct = top ? (d.value / top) * 100 : 0
                  const labelled = d.value > 0 && (i === last || i === maxIndex)
                  return (
                    <li key={d.key} tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`}
                      className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none">
                      <span className="absolute inset-0 rounded-sm group-hover:bg-slate-100/70 group-focus-visible:bg-slate-100/70" aria-hidden="true" />
                      <span className="relative w-full max-w-7 rounded-t bg-chart transition-opacity ease-out group-hover:opacity-85 motion-safe:transition-[height,opacity] motion-safe:duration-300"
                        style={{ height: `${Math.max(pct, d.value > 0 ? 1 : 0)}%` }} aria-hidden="true" />
                      {labelled && (
                        <span className="absolute -translate-y-1 text-[11px] font-semibold whitespace-nowrap text-ink tabular-nums" style={{ bottom: `${pct}%` }} aria-hidden="true">
                          ₱{compact.format(d.value)}
                        </span>
                      )}
                      <span role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-2 hidden min-w-36 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-xs text-white shadow-lg group-hover:block group-focus-visible:block" style={{ left: '50%' }}>
                        <span className="block font-semibold">{d.label}</span>
                        {d.tooltip.map((line) => <span key={line} className="block text-white/85">{line}</span>)}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
            <div className="mt-1.5 flex gap-[2px]" aria-hidden="true">
              {data.map((d, i) => (
                <span key={d.key} className={`flex-1 text-center text-[11px] ${i === last ? 'font-semibold text-ink' : 'text-slate-400'}`}>{d.short}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Ranked horizontal bars. items: [{ key, to, title, subtitle, value, valueText, detail }] */
export function RankBars({ items }) {
  const max = Math.max(0, ...items.map((i) => i.value))
  return (
    <ol className="space-y-3.5">
      {items.map((it, i) => (
        <li key={it.key}>
          <div className="mb-1 flex items-baseline gap-2 text-sm">
            <span className="w-4 shrink-0 text-xs font-semibold text-slate-400 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              {it.to ? <Link to={it.to} className="font-semibold text-brand hover:underline">{it.title}</Link> : <span className="font-semibold">{it.title}</span>}
              <span className="text-slate-500"> · {it.subtitle}</span>
            </span>
            <span className="font-semibold text-ink tabular-nums">{it.valueText}</span>
          </div>
          <div className="ml-6 flex items-center gap-2">
            <div className="h-2 flex-1 rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-2 rounded-full bg-chart ease-out motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${max ? (it.value / max) * 100 : 0}%` }} />
            </div>
            <span className="w-24 shrink-0 text-right text-xs text-slate-500 tabular-nums">{it.detail}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}
