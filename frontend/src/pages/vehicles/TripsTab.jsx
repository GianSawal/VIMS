import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { Button, Modal } from '../../components/ui'
import DispatchForm from '../trips/DispatchForm'
import { tripColumns } from '../trips/TripList'
import { km } from '../trips/common'

export default function TripsTab({ v }) {
  const can = useCan()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [dispatching, setDispatching] = useState(false)
  const query = useList('/trips/', { vehicle: v.id, page })
  const summary = useList('/trips/summary/', { vehicle: v.id })
  const s = summary.data
  const onTrip = (s?.by_status.DISPATCHED ?? 0) > 0
  const available = !v.is_archived && ['SERVICEABLE', 'IN_USE'].includes(v.status)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <Fact label="Trips recorded" value={s ? s.total : '…'} />
        <Fact label="Completed distance" value={s ? km(s.distance_km) : '…'} />
        <Fact label="Right now" value={s ? (onTrip ? 'Out on a trip' : 'Not on a trip') : '…'} />
        {can('operations.add_trip') && (
          <div className="ml-auto flex items-center gap-3">
            {!available && <span className="text-xs text-slate-500">{v.is_archived ? 'Archived' : v.status_display}: cannot be dispatched</span>}
            {available && onTrip && <span className="text-xs text-slate-500">Record the return of the current trip first</span>}
            <Button onClick={() => setDispatching(true)} disabled={!available || onTrip}><Plus size={16} /> Dispatch trip</Button>
          </div>
        )}
      </div>

      <DataTable columns={tripColumns({ withVehicle: false })} query={query} page={page} onPage={setPage}
        onRowClick={(t) => navigate(`/trips/${t.id}`)} empty="No trips recorded for this vehicle yet." />

      <Modal open={dispatching} onClose={() => setDispatching(false)} title={`Dispatch ${v.plate_number}`} wide>
        {dispatching && <DispatchForm vehicle={v} onClose={() => setDispatching(false)} onSaved={(t) => navigate(`/trips/${t.id}`)} />}
      </Modal>
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
