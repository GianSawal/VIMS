import { ChevronLeft, ChevronRight } from 'lucide-react'
import { errorMessage } from '../api'

const PAGE_SIZE = 25

/**
 * columns: [{ key, label, render?(row), className? }]
 * query: a useList() result ({ data: {count, results}, isLoading, isError, error, isFetching })
 */
export default function DataTable({ columns, query, page, onPage, empty = 'No records found.' }) {
  const { data, isLoading, isError, error, isFetching } = query
  const rows = data?.results ?? []
  const pages = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE))

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className={`w-full text-left text-sm ${isFetching && !isLoading ? 'opacity-60' : ''}`}>
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              {columns.map((c) => <th key={c.key} scope="col" className="px-4 py-3 font-semibold">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && [...Array(5)].map((_, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-slate-200" /></td>
                ))}
              </tr>
            ))}
            {isError && (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-danger">{errorMessage(error)}</td></tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">{empty}</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 ${c.className ?? ''}`}>{c.render ? c.render(row) : row[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-sm text-slate-600">
          <span>{data.count} record{data.count === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button className="rounded p-1 hover:bg-slate-100 disabled:opacity-40" disabled={page <= 1}
              onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
            <span>Page {page} of {pages}</span>
            <button className="rounded p-1 hover:bg-slate-100 disabled:opacity-40" disabled={page >= pages}
              onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={18} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
