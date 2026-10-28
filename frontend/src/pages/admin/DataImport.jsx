import { Link } from 'react-router-dom'
import { Download, FileSpreadsheet } from 'lucide-react'
import { PageHeader } from '../../components/ui'

// The download is all the app does; the import runs on the server (dry run, review, then --commit). See docs/MIGRATION.md.
const STEPS = [
  <>Set up every office first in <Link to="/admin/offices" className="font-medium text-brand hover:underline">Offices</Link>. Offices are not imported.</>,
  <>Download the template and fill one sheet per kind of record: vehicles, drivers, assignments, documents, maintenance, fuel, trips and toll. The <em>Instructions</em> sheet lists every column and the allowed values. Leave a sheet empty to skip it.</>,
  <>Give the filled workbook to the system administrator, who runs a dry run on the server, reviews the issues report with you and then imports it.</>,
]

export default function DataImport() {
  return (
    <div>
      <PageHeader title="Data import">Bring records from the old spreadsheets into the system.</PageHeader>
      <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand">
            <FileSpreadsheet size={20} aria-hidden="true" />
          </span>
          <div className="mr-auto">
            <h2 className="font-semibold text-ink">Import workbook template</h2>
            <p className="text-sm text-slate-500">Excel (.xlsx), one sheet per record type</p>
          </div>
          <a href="/api/import/template/" download
            className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-dark active:scale-[.97]">
            <Download size={16} aria-hidden="true" /> Download template
          </a>
        </div>
        <ol className="space-y-2.5 border-t border-slate-100 pt-4 text-sm text-slate-600">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          Running the same workbook again is safe: records already in the system are skipped and existing values are never overwritten.
        </p>
      </section>
    </div>
  )
}
