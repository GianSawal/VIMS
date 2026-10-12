import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { api, errorMessage } from '../../api'
import { useCan } from '../../auth'
import Attachments from '../../components/Attachments'
import { Badge, Button, formatDateTime, Modal } from '../../components/ui'
import { NotFound } from '../Errors'
import { formatDate, formatKm, formatPeso } from '../vehicles/common'
import FuelForm from './FuelForm'
import { KmPerLiter } from './FuelList'

export default function FuelDetail() {
  const { id } = useParams()
  const can = useCan()
  const [editing, setEditing] = useState(false)
  const q = useQuery({ queryKey: ['/fuel-records/', id], queryFn: () => api.get(`/fuel-records/${id}/`).then((r) => r.data) })
  const r = q.data

  if (q.isLoading) return <div className="h-56 animate-pulse rounded-xl bg-slate-200" />
  if (q.error?.response?.status === 404) return <NotFound />
  if (q.isError) return <div className="text-danger">{errorMessage(q.error)}</div>

  const canChange = can('operations.change_fuelrecord')
  const rows = [
    ['Vehicle', <Link key="v" to={`/vehicles/${r.vehicle}`} className="font-medium text-brand hover:underline">{r.plate_number}</Link>],
    ['Driver', r.driver_name ?? '—'],
    ['Fuel type', r.fuel_type_display],
    ['Liters', `${Number(r.liters).toLocaleString('en-PH', { maximumFractionDigits: 3 })} L`],
    ['Price per liter', formatPeso(r.unit_price)],
    ['Total amount', formatPeso(r.total_amount)],
    ['Odometer', formatKm(r.odometer)],
    ['Distance since last fill-up', r.distance_since_last != null ? formatKm(r.distance_since_last) : '—'],
    ['PO number', r.po_number || '—'],
    ['Supplier / station', r.supplier || '—'],
    ['Receipt / reference', r.receipt_number || '—'],
  ]

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-slate-500">
        <Link to="/fuel" className="hover:underline">Fuel</Link> / <span aria-current="page">{r.plate_number} · {formatDate(r.date)}</span>
      </nav>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto flex flex-wrap items-center gap-3 text-2xl font-bold text-brand">
          {r.plate_number} fill-up, {formatDate(r.date)}
          {r.is_full_tank && <Badge tone="blue">Full tank</Badge>}
        </h1>
        {canChange && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} /> Edit</Button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <dl className="grid gap-x-8 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm">
                <dt className="text-slate-500">{label}</dt><dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {r.remarks && <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm whitespace-pre-line">{r.remarks}</p>}
          <p className="mt-4 text-xs text-slate-400">Recorded {formatDateTime(r.created_at)} · Updated {formatDateTime(r.updated_at)}</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-brand">Estimated efficiency</h2>
          <div className="text-2xl"><KmPerLiter r={r} /></div>
          <p className="mt-3 text-xs text-slate-500">
            {r.km_per_liter
              ? 'Distance since the previous full tank divided by all liters added since then. An estimate, not a measurement.'
              : r.is_full_tank ? 'No earlier full-tank fill-up to compare with yet.' : 'Only estimated for full-tank fill-ups.'}
          </p>
          {r.usual_km_per_liter && <p className="mt-2 text-sm">Usual for this vehicle: <strong>{Number(r.usual_km_per_liter).toFixed(2)} km/L</strong> (est.)</p>}
        </section>
      </div>

      <div className="mt-4">
        <Attachments basePath={`/fuel-records/${r.id}`} canChange={canChange} title="Receipt and PO scans" />
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit fuel record" wide>
        {editing && <FuelForm record={r} onClose={() => setEditing(false)} />}
      </Modal>
    </div>
  )
}
