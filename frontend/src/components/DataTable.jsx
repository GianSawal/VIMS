import { useEffect, useLayoutEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { errorMessage, PAGE_SIZE } from '../api'

/**
 * Paging through the same results keeps the table steady: column widths only grow (each page's text would
 * otherwise resize them and shift every column) and the box keeps its tallest height (a short last page
 * would pull the footer up). Applied before paint. Resets when the result set (count/columns) changes or
 * the window resizes, and never grows the columns past what fits, so it adds no sideways scroll.
 */
function useSteadySize(data, count, cols) {
  const box = useRef(null)
  const kept = useRef(null)

  const clear = () => {
    kept.current = null
    const el = box.current
    if (!el) return
    el.style.minHeight = ''
    el.querySelectorAll('thead th').forEach((th) => { th.style.minWidth = '' })
  }

  useLayoutEffect(() => {
    const el = box.current
    if (!el || !data) return
    if (kept.current?.count !== count || kept.current?.cols !== cols) {
      clear()
      kept.current = { count, cols, widths: [], height: 0 }
    }
    if (!data.results?.length) return
    const ths = [...el.querySelectorAll('thead th')]
    const k = kept.current
    const now = ths.map((th) => th.getBoundingClientRect().width)
    const grown = now.map((w, i) => Math.max(w, k.widths[i] ?? 0))
    const sum = (a) => a.reduce((s, w) => s + w, 0)
    // Wider than the box (and than the table already is): start again from this page's widths instead.
    k.widths = sum(grown) > Math.max(el.clientWidth, sum(now)) + 1 ? now : grown
    ths.forEach((th, i) => { th.style.minWidth = `${k.widths[i]}px` })
    k.height = Math.max(k.height, el.offsetHeight)
    el.style.minHeight = `${k.height}px`
  }, [data, count, cols]) // eslint-disable-line react-hooks/exhaustive-deps -- clear only touches refs

  useEffect(() => {
    window.addEventListener('resize', clear)
    return () => window.removeEventListener('resize', clear)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- clear only touches refs

  return box
}

/**
 * columns: [{ key, label, render?(row), className?, align? }]
 * query: a useList() result ({ data: {count, results}, isLoading, isError, error, isFetching })
 * toolbar: optional node rendered inside the card, above the header (filters, search)
 * onRowClick: optional; mouse convenience only, so keep a real link in the row for keyboard users
 * footer: false hides the count/pagination bar (for "latest N" mini tables)
 * mobileCard: optional (row) -> node. Below md the rows render as these cards instead of the table; md and up
 *   keep the table exactly as without it. The toolbar and pagination are shared by both.
 */
// Phone view of the rows: one card each, same loading / error / empty states as the table.
// The whole card is tappable when onRowClick is set; the card's own link stays the keyboard route.
function MobileList({ rows, query, onRowClick, empty, card }) {
  const { isLoading, isError, error, isFetching } = query
  const state = (text, tone = 'text-slate-500') => <p className={`px-4 py-10 text-center text-sm ${tone}`}>{text}</p>
  return (
    <div className={`md:hidden ${isFetching && !isLoading ? 'opacity-60' : ''}`}>
      {isLoading ? (
        <ul className="divide-y divide-slate-100" aria-busy="true">
          {[...Array(4)].map((_, i) => (
            <li key={i} className="flex gap-3 p-4">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-200" />
              <div className="flex-1 space-y-2"><div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" /><div className="h-3 w-1/2 animate-pulse rounded bg-slate-200" /></div>
            </li>
          ))}
        </ul>
      ) : isError ? state(errorMessage(error), 'text-danger')
        : !rows.length ? state(empty)
        : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <li key={row.id} style={{ '--i': Math.min(i, 10) }} onClick={onRowClick && (() => onRowClick(row))}
                className={`row-in p-4 ${onRowClick ? 'cursor-pointer active:bg-brand-light/40' : ''}`}>
                {card(row)}
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

export default function DataTable({ columns, query, page = 1, onPage, toolbar, onRowClick, footer = true, empty = 'No records found.', mobileCard }) {
  const { data, isLoading, isError, error, isFetching } = query
  const rows = data?.results ?? []
  const count = data?.count ?? 0
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const first = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const last = Math.min(page * PAGE_SIZE, count)
  const box = useSteadySize(data, count, columns.length)

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {toolbar}
      {/* relative: keeps absolutely placed children (sr-only header labels) inside the scroll box, or they widen the page.
          overflow-y-hidden: the rows' 4px settle-in would otherwise flash a vertical scrollbar and resize the table. */}
      {mobileCard && <MobileList rows={rows} query={query} onRowClick={onRowClick} empty={empty} card={mobileCard} />}
      <div ref={box} className={`relative overflow-x-auto overflow-y-hidden ${mobileCard ? 'hidden md:block' : ''}`}>
        <table className={`w-full text-left text-sm ${isFetching && !isLoading ? 'opacity-60' : ''}`}>
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] tracking-wider text-slate-500 uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`px-4 py-3 font-semibold ${c.className ?? ''}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && [...Array(5)].map((_, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-4"><div className="h-4 animate-pulse rounded bg-slate-200" /></td>
                ))}
              </tr>
            ))}
            {isError && (
              <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-danger">{errorMessage(error)}</td></tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-slate-500">{empty}</td></tr>
            )}
            {rows.map((row, i) => (
              <tr key={row.id} onClick={onRowClick && (() => onRowClick(row))} style={{ '--i': Math.min(i, 10) }}
                className={`row-in hover:bg-brand-light/40 ${onRowClick ? 'cursor-pointer' : ''}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-middle ${c.className ?? ''}`}>{c.render ? c.render(row) : row[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && footer && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
          <span>{count === 0 ? 'No records' : <>Showing <strong className="font-semibold text-ink">{first}–{last}</strong> of <strong className="font-semibold text-ink">{count}</strong></>}</span>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-slate-300 bg-white p-1.5 hover:bg-slate-100 disabled:opacity-40" disabled={page <= 1}
              onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
            <span className="min-w-20 text-center">Page {page} of {pages}</span>
            <button className="rounded-md border border-slate-300 bg-white p-1.5 hover:bg-slate-100 disabled:opacity-40" disabled={page >= pages}
              onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
