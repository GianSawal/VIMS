import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, IdCard, KeyRound, Milestone, MessageSquareWarning, Phone, UserRound } from 'lucide-react'
import { errorMessage } from '../../api'
import { initials } from '../../components/filters'
import { Badge, Button, Modal, PageHeader } from '../../components/ui'
import { formatDate } from '../vehicles/common'
import { CorrectionForm, licenseText, licenseTone, useDriverHome, VehicleCard } from './driver'
import { km } from './common'

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

  return (
    <>
      <PageHeader title="My profile" actions={<Button variant="secondary" onClick={() => setCorrecting(true)}><MessageSquareWarning size={16} aria-hidden="true" /> Request a correction</Button>}>
        Kept by the office. Something wrong or changed? Request a correction.
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Driver">
          <div className="mb-2 flex items-center gap-3">
            {d.photo_url
              ? <img src={d.photo_url} alt="" className="h-16 w-16 rounded-xl object-cover" />
              : <div aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-xl bg-brand-light text-xl font-bold text-brand">{initials(d.full_name)}</div>}
            <div><div className="text-lg font-bold">{d.full_name}</div><div className="text-sm text-slate-500">{d.office_name}</div></div>
          </div>
          <dl className="divide-y divide-slate-100">
            <Item icon={UserRound} label="Employee no.">{d.employee_number}</Item>
            <Item icon={Building2} label="Office">{d.office_code}</Item>
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

        <Card title="Driving">
          <dl className="divide-y divide-slate-100">
            <Item icon={Milestone} label="This month">{month.trips} trip{month.trips === 1 ? '' : 's'} · {km(month.distance_km)}</Item>
            <Item icon={Milestone} label="This year">{year.trips} trip{year.trips === 1 ? '' : 's'} · {km(year.distance_km)}</Item>
          </dl>
          <Link to="/my-trips/history" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Trip history</Link>
        </Card>

        <Card title="Account">
          <dl className="divide-y divide-slate-100">
            <Item icon={UserRound} label="Username"><span className="font-mono">{d.username}</span></Item>
          </dl>
          <Link to="/change-password" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><KeyRound size={14} aria-hidden="true" /> Change password</Link>
        </Card>
      </div>

      <h2 className="mt-6 mb-2 font-semibold text-ink">My vehicle{vehicles.length === 1 ? '' : 's'}</h2>
      {vehicles.length
        ? <div className="space-y-3">{vehicles.map((v) => <VehicleCard key={v.id} v={v} />)}</div>
        : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No vehicle is assigned to you right now.</p>}

      <Modal open={correcting} onClose={() => setCorrecting(false)} title="Request a correction">
        {correcting && <CorrectionForm onClose={() => setCorrecting(false)} />}
      </Modal>
    </>
  )
}
