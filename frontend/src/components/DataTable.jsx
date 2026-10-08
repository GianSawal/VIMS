import { ChevronLeft, ChevronRight } from 'lucide-react'
import { errorMessage } from '../api'

const PAGE_SIZE = 25

/**
 * columns: [{ key, label, render?(row), className?, align? }]
 * query: a useList() result ({ data: {count, results}, isLoading, isError, error, isFetching })
 * toolbar: optional node rendered inside the card, above the header (filters, search)
 * onRowClick: optional; mouse convenience only, so keep a real link in the row for keyboard users
 */
export default function DataTable({ columns, query, page, onPage, toolbar, onRowClick, empty = 'No records found.' }) {
  const { data, isLoading, isError, error, isFetching } = query
  const rows = data?.results ?? []
  const count = data?.count ?? 0
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const first = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const last = Math.min(page * PAGE_SIZE, count)

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {toolbar}
      <div className="overflow-x-auto">
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
            {rows.map((row) => (
              <tr key={row.id} onClick={onRowClick && (() => onRowClick(row))}
                className={`hover:bg-brand-light/40 ${onRowClick ? 'cursor-pointer' : ''}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-middle ${c.className ?? ''}`}>{c.render ? c.render(row) : row[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
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
