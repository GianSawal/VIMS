import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { api, errorMessage } from '../../api'
import { Button } from '../../components/ui'
import { km, shortDateTime } from './common'

/** Bare printable trip ticket (/trips/:id/ticket): for guards and checkpoints. The API decides who may see the trip. */
export default function TripTicket() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['/trips/', id], queryFn: () => api.get(`/trips/${id}/`).then((r) => r.data) })
  const t = q.data
  const [printedAt] = useState(() => new Date().toISOString())
  useEffect(() => { if (t) document.title = `Trip ticket ${t.ticket_number} - DOLE VRS` }, [t])

  if (q.isError) return <p className="p-8 text-danger">{errorMessage(q.error)}</p>
  if (!t) return <p className="p-8 text-slate-500">Loading trip ticket…</p>
  const row = (label, value) => (
    <div className="grid grid-cols-[10rem_1fr] gap-2 border-b border-slate-200 py-1.5 text-sm">
      <dt className="text-slate-600">{label}</dt><dd className="font-medium">{value || '—'}</dd>
    </div>
  )
  return (
    <div className="mx-auto max-w-[210mm] bg-white p-6 text-ink print:max-w-none print:p-0">
      <style>{'@page { size: A4 portrait; margin: 14mm } @media print { body { background: white } }'}</style>
      <div className="mb-4 flex gap-2 print:hidden">
        <Button onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print</Button>
        <Button variant="secondary" onClick={() => window.history.back()}>Back</Button>
      </div>
      <header className="mb-4 flex items-center gap-3 border-b-2 border-brand pb-3">
        <img src="/dole-logo.png" alt="DOLE logo" className="h-14 w-14" />
        <div className="flex-1">
          <p className="text-[11px]">Republic of the Philippines</p>
          <p className="text-sm font-bold text-brand">Department of Labor and Employment</p>
          <h1 className="text-lg leading-tight font-bold">Driver&apos;s Trip Ticket</h1>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Ticket no.</div>
          <div className="font-mono text-lg font-bold">{t.ticket_number}</div>
          <div className="text-xs">{t.status_display}</div>
        </div>
      </header>
      <dl>
        {row('Driver', t.driver_name)}
        {row('Vehicle', `${t.plate_number} · ${t.vehicle_label}`)}
        {row('Requesting office', [t.requesting_office_name, t.requesting_division].filter(Boolean).join(' · '))}
        {row('Passengers', t.passengers)}
        {row('From', t.origin)}
        {row('To', t.destination)}
        {row('Purpose', t.purpose)}
        {row('Scheduled', t.scheduled_departure && shortDateTime(t.scheduled_departure))}
        {row('Departed', t.departed_at && shortDateTime(t.departed_at))}
        {row('Returned', t.returned_at && shortDateTime(t.returned_at))}
        {row('Odometer', t.odometer_start != null && `${km(t.odometer_start)}${t.odometer_end != null ? ` → ${km(t.odometer_end)}` : ''}`)}
        {row('Distance', t.distance_km != null && km(t.distance_km))}
      </dl>
      <div className="mt-14 grid grid-cols-2 gap-10 text-center text-sm">
        {['Driver', 'Approved by'].map((who) => (
          <div key={who}><div className="border-t border-ink pt-1">{who === 'Driver' ? t.driver_name : ' '}</div><div className="text-xs text-slate-600">{who}</div></div>
        ))}
      </div>
      <p className="mt-8 text-[10px] text-slate-500">Printed {shortDateTime(printedAt)} from DOLE VRS.</p>
    </div>
  )
}
