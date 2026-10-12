import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { Button, Modal } from '../../components/ui'
import FuelForm from '../fuel/FuelForm'
import { fuelColumns } from '../fuel/FuelList'
import { formatPeso } from './common'

export default function FuelTab({ v }) {
  const can = useCan()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const query = useList('/fuel-records/', { vehicle: v.id, page })
  const summary = useList('/fuel-records/summary/', { vehicle: v.id })
  const s = summary.data
  const usual = query.data?.results.find((r) => r.usual_km_per_liter)?.usual_km_per_liter

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <Fact label="Fill-ups" value={s ? s.count : '…'} />
        <Fact label="Liters" value={s ? `${Number(s.liters).toLocaleString('en-PH')} L` : '…'} />
        <Fact label="Total cost" value={s ? formatPeso(s.amount) : '…'} />
        <Fact label="Usual efficiency" value={usual ? `${Number(usual).toFixed(2)} km/L est.` : '—'}
          hint={usual ? 'Full tank to full tank' : 'Needs two full-tank fill-ups'} />
        {can('operations.add_fuelrecord') && !v.is_archived && (
          <Button className="ml-auto" onClick={() => setAdding(true)}><Plus size={16} /> Add fuel record</Button>
        )}
      </div>
      <DataTable columns={fuelColumns({ withVehicle: false })} query={query} page={page} onPage={setPage}
        onRowClick={(r) => navigate(`/fuel/${r.id}`)} empty="No fuel records for this vehicle yet." />
      <Modal open={adding} onClose={() => setAdding(false)} title={`Add fuel record: ${v.plate_number}`} wide>
        {adding && <FuelForm vehicle={v} onClose={() => setAdding(false)} />}
      </Modal>
    </div>
  )
}

function Fact({ label, value, hint }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  )
}
