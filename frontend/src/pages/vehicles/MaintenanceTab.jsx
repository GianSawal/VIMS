import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Pencil, Plus } from 'lucide-react'
import { useList } from '../../api'
import { useCan } from '../../auth'
import DataTable from '../../components/DataTable'
import { Button, Modal } from '../../components/ui'
import { DueBadge, dueParts, intervalText } from '../maintenance/common'
import { recordColumns } from '../maintenance/MaintenanceList'
import MaintenanceForm from '../maintenance/MaintenanceForm'
import ScheduleForm from '../maintenance/ScheduleForm'
import { formatDate, formatKm, formatPeso } from './common'

export default function MaintenanceTab({ v }) {
  const can = useCan()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null) // 'record' | 'schedule' | schedule object
  const records = useList('/maintenance/', { vehicle: v.id, page })
  const schedules = useList('/maintenance-schedules/', { vehicle: v.id, page_size: 50 })
  const summary = useList('/maintenance/summary/', { vehicle: v.id })
  const s = summary.data
  const canEditSchedule = can('maintenance.change_maintenanceschedule')
  const editing = dialog && typeof dialog === 'object'

  return (
    <div className="space-y-4">
      <section aria-labelledby="pm-title">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="pm-title" className="mr-auto font-semibold text-ink">Preventive maintenance</h2>
          {can('maintenance.add_maintenanceschedule') && !v.is_archived && (
            <Button variant="secondary" onClick={() => setDialog('schedule')}><CalendarClock size={16} /> Add schedule</Button>
          )}
          {can('maintenance.add_maintenancerecord') && !v.is_archived && (
            <Button onClick={() => setDialog('record')}><Plus size={16} /> Add maintenance</Button>
          )}
        </div>
        {schedules.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
          : schedules.data?.results.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {schedules.data.results.map((sc) => (
                <article key={sc.id} className={`rounded-xl border border-l-4 bg-white p-4 shadow-sm ${
                  sc.due.status === 'OVERDUE' ? 'border-red-200 border-l-danger' : sc.due.status === 'DUE_SOON' ? 'border-amber-200 border-l-amber-500' : 'border-slate-200 border-l-slate-300'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{sc.category_name}</div>
                      <div className="text-xs text-slate-500">{intervalText(sc)}</div>
                    </div>
                    <DueBadge status={sc.due.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-slate-500">Last service</dt><dd>{sc.last_service_date ? formatDate(sc.last_service_date) : '—'}{sc.last_service_odometer != null && <span className="block text-xs text-slate-500">{formatKm(sc.last_service_odometer)}</span>}</dd></div>
                    <div><dt className="text-xs text-slate-500">Next due</dt><dd>{sc.due.due_date ? formatDate(sc.due.due_date) : '—'}{sc.due.due_odometer != null && <span className="block text-xs text-slate-500">{sc.due.due_date ? 'or ' : ''}{formatKm(sc.due.due_odometer)}</span>}</dd></div>
                  </dl>
                  {sc.due.status !== 'NO_BASELINE' && (
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-xs">
                      <span className="mr-auto">{dueParts(sc.due).map(([text, late], i) => <span key={text} className={late ? 'font-medium text-danger' : 'text-slate-600'}>{i > 0 && ' · '}{text}</span>)}</span>
                      {canEditSchedule && <Button variant="ghost" onClick={() => setDialog(sc)} aria-label={`Edit schedule ${sc.category_name}`}><Pencil size={14} /></Button>}
                    </div>
                  )}
                  {sc.due.status === 'NO_BASELINE' && canEditSchedule && (
                    <div className="mt-3 flex items-center border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <span className="mr-auto">Enter the last service, or complete a job, to start tracking.</span>
                      <Button variant="ghost" onClick={() => setDialog(sc)} aria-label={`Edit schedule ${sc.category_name}`}><Pencil size={14} /></Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No preventive schedules for this vehicle yet. Add one (e.g. oil change every 5,000 km or 6 months) to track what is due.
            </div>
          )}
      </section>

      <section aria-labelledby="mh-title">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h2 id="mh-title" className="mr-auto font-semibold text-ink">Maintenance history</h2>
          {s && <span className="text-sm text-slate-500">{s.total} record{s.total === 1 ? '' : 's'} · completed work <strong className="text-ink">{formatPeso(s.cost)}</strong></span>}
        </div>
        <DataTable columns={recordColumns({ withVehicle: false })} query={records} page={page} onPage={setPage}
          onRowClick={(r) => navigate(`/maintenance/${r.id}`)} empty="No maintenance recorded for this vehicle yet." />
      </section>

      <Modal open={dialog === 'record'} onClose={() => setDialog(null)} title={`Add maintenance: ${v.plate_number}`} wide>
        {dialog === 'record' && <MaintenanceForm vehicle={v} onClose={() => setDialog(null)} onSaved={(r) => navigate(`/maintenance/${r.id}`)} />}
      </Modal>
      <Modal open={dialog === 'schedule' || editing} onClose={() => setDialog(null)} title={editing ? `Edit schedule: ${dialog.category_name}` : `Add preventive schedule: ${v.plate_number}`} wide>
        {(dialog === 'schedule' || editing) && <ScheduleForm vehicle={v} schedule={editing ? dialog : undefined} onClose={() => setDialog(null)} />}
      </Modal>
    </div>
  )
}
