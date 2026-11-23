import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, History, IdCard, KeyRound, MessageSquareWarning, Phone, UserRound } from 'lucide-react'
import { errorMessage } from '../../api'
import { initials } from '../../components/filters'
import { Badge, Button, Modal } from '../../components/ui'
import { formatDate } from '../vehicles/common'
import { CorrectionForm, licenseText, licenseTone, useDriverHome, VehicleCard } from './driver'

function Item({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Icon size={16} className="shrink-0 text-brand" aria-hidden="true" />
      <dt className="w-32 shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words">{children || <span className="text-slate-400">Not recorded</span>}</dd>
    </div>
  )
}

const Card = ({ title, children, action }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-semibold text-ink">{title}</h2>{action}</div>
    {children}
  </section>
)

/** Driver accounts: their record as the office keeps it (read-only), license, vehicles, totals and account. */
export default function MyProfile() {
  const home = useDriverHome()
  const [correcting, setCorrecting] = useState(false)
  if (home.isLoading) return <div className="h-48 animate-pulse rounded-xl bg-slate-200" />
  if (home.isError) return <p className="text-danger">{errorMessage(home.error)}</p>
  const { driver: d, vehicles, month, year } = home.data
  if (!d) return <p className="text-slate-600">This login is not linked to a driver record. Ask the System Administrator.</p>

  const tiles = [['Trips this month', month.trips], ['Km this month', month.distance_km.toLocaleString('en-PH')],
    ['Trips this year', year.trips], ['Km this year', year.distance_km.toLocaleString('en-PH')]]
  return (
    <>
      <section aria-label="Driver" className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="relative h-20 overflow-hidden bg-gradient-to-r from-brand to-brand-dark" aria-hidden="true">
          <img src="/dole-logo.png" alt="" className="absolute -top-6 right-2 h-32 w-32 opacity-10" />
        </div>
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
          <div className="relative z-10 -mt-12 shrink-0"> {/* above the positioned banner strip, which would otherwise paint over it */}
            {d.photo_url
              ? <img src={d.photo_url} alt={`Photo of ${d.full_name}`} className="h-24 w-24 rounded-2xl border-4 border-white bg-white object-cover shadow-md" />
              : <div role="img" aria-label="No photo" className="flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-white bg-brand-light text-3xl font-bold text-brand shadow-md">{initials(d.full_name)}</div>}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl leading-tight font-bold text-ink">{d.full_name}</h1>
            <p className="text-sm text-slate-500">Driver · {d.office_name}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={licenseTone[d.license_status]} dot>License {licenseText(d).toLowerCase()}</Badge>
              <Badge tone="blue">{d.license_type}</Badge>
            </div>
          </div>
          <Button variant="secondary" onClick={() => setCorrecting(true)}><MessageSquareWarning size={16} aria-hidden="true" /> Request a correction</Button>
        </div>
        <dl className="grid grid-cols-2 border-t border-slate-100 sm:grid-cols-4">
          {tiles.map(([label, value], i) => (
            <div key={label} className={`px-5 py-3 ${i % 2 ? 'border-l' : ''} ${i > 1 ? 'border-t sm:border-t-0' : ''} ${i === 2 ? 'sm:border-l' : ''} border-slate-100`}>
              <dt className="text-xs text-slate-500">{label}</dt><dd className="text-xl font-bold text-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <p className="mb-4 text-sm text-slate-500">Your record is kept by the office. Something wrong or changed (new number, renewed license)? Use Request a correction.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Contact and record">
          <dl className="divide-y divide-slate-100">
            <Item icon={UserRound} label="Employee no.">{d.employee_number}</Item>
            <Item icon={Building2} label="Office">{d.office_code} · {d.office_name}</Item>
            <Item icon={Phone} label="Contact">{d.contact_number}</Item>
          </dl>
        </Card>

        <Card title="License" action={<Badge tone={licenseTone[d.license_status]} dot>{licenseText(d)}</Badge>}>
          <dl className="divide-y divide-slate-100">
            <Item icon={IdCard} label="Number"><span className="font-mono">{d.license_number}</span></Item>
            <Item icon={IdCard} label="Type">{d.license_type}</Item>
            <Item icon={IdCard} label="Restrictions">{d.license_restrictions}</Item>
            <Item icon={IdCard} label="Issued">{d.license_issue_date && formatDate(d.license_issue_date)}</Item>
            <Item icon={IdCard} label="Expires">{formatDate(d.license_expiry_date)}</Item>
          </dl>
        </Card>

        <Card title="Account">
          <dl className="divide-y divide-slate-100">
            <Item icon={UserRound} label="Username"><span className="font-mono">{d.username}</span></Item>
          </dl>
          <div className="mt-2 flex flex-wrap gap-4">
            <Link to="/change-password" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><KeyRound size={14} aria-hidden="true" /> Change password</Link>
            <Link to="/my-trips/history" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><History size={14} aria-hidden="true" /> Trip history</Link>
          </div>
        </Card>
      </div>

      <h2 className="mt-6 mb-2 font-semibold text-ink">My vehicle{vehicles.length === 1 ? '' : 's'}</h2>
      {vehicles.length
        ? <div className="grid gap-3 sm:grid-cols-2">{vehicles.map((v) => <VehicleCard key={v.id} v={v} />)}</div>
        : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No vehicle is assigned to you right now.</p>}

      <Modal open={correcting} onClose={() => setCorrecting(false)} title="Request a correction">
        {correcting && <CorrectionForm onClose={() => setCorrecting(false)} />}
      </Modal>
    </>
  )
}
