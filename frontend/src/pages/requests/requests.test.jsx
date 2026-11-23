import { fireEvent, screen } from '@testing-library/react'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { meWith, renderApp } from '../../test/render'
import RequestDetail from './RequestDetail'
import RequestList from './RequestList'

const REQUESTER = ['operations.add_vehiclerequest', 'operations.change_vehiclerequest', 'operations.view_vehiclerequest']
const APPROVER = [...REQUESTER, 'operations.approve_vehiclerequest', 'operations.view_trip']

const base = {
  id: 7, reference_number: 'VR-2026-00007', requester: 1, requester_name: 'Ana Cruz', office: 2, office_code: 'TAR',
  office_name: 'Tarlac', purpose: 'Labor inspection', origin: 'RO', destination: 'Tarlac City', passengers: '',
  needed_at: '2026-12-01T00:00:00Z', return_at: null, remarks: '', status: 'PENDING', status_display: 'Pending',
  progress: 'PENDING', decided_by_name: null, decided_at: null, decision_note: '', trip: null, created_at: '2026-11-20T00:00:00Z',
  route_geometry: null, origin_lat: null, destination_lat: null, estimated_distance_km: null,
}
const approved = {
  ...base, status: 'APPROVED', progress: 'APPROVED', decided_by_name: 'Fleet Admin', decided_at: '2026-11-21T00:00:00Z',
  trip: { id: 3, ticket_number: 'TT-2026-00003', status: 'SCHEDULED', status_display: 'Scheduled', plate_number: 'SAB 1234',
          vehicle_label: 'Toyota Innova', vehicle_photo_url: null, driver_name: null, driver_contact: null, driver_photo_url: null },
}

function show(request, perms, userId = 1) {
  renderApp(null, {
    me: meWith(perms, { id: userId }), path: '/requests/7',
    routes: <Route path="/requests/:id" element={<RequestDetail />} />,
    data: { '["/vehicle-requests/","7"]': request, '["/vehicle-requests/7/","attachments"]': [] },
  })
}

describe('vehicle request detail', () => {
  it('requester sees the booked vehicle, driver still to be assigned, and can cancel', () => {
    show(approved, REQUESTER)
    expect(screen.getByText('SAB 1234')).toBeInTheDocument()
    expect(screen.getByText('To be assigned before departure')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel request/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'TT-2026-00003' })).not.toBeInTheDocument() // no trip access
  })

  it('approver sees approve and decline on a pending request of someone else', () => {
    show(base, APPROVER, 99)
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel request/i })).not.toBeInTheDocument()
  })

  it('shows the decline reason', () => {
    show({ ...base, status: 'DECLINED', progress: 'DECLINED', decision_note: 'No vehicle that day', decided_at: '2026-11-21T00:00:00Z' }, REQUESTER)
    expect(screen.getByText('No vehicle that day')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel request/i })).not.toBeInTheDocument()
  })
})

describe('vehicle request list', () => {
  it('requester: current request up front with the booked vehicle and progress, then the history', () => {
    const done = { ...base, id: 8, reference_number: 'VR-2026-00008', destination: 'Bataan', status: 'DECLINED', progress: 'DECLINED' }
    renderApp(<RequestList />, {
      me: meWith(REQUESTER, { first_name: 'Ana' }), path: '/requests',
      data: { '["/vehicle-requests/",{"page_size":100}]': { count: 2, results: [approved, done] } },
    })
    expect(screen.getByRole('heading', { name: /, Ana$/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your current request' })).toBeInTheDocument()
    expect(screen.getByText('SAB 1234')).toBeInTheDocument()
    expect(screen.getByText('Driver to be assigned')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Approved')
    // tabs only for statuses that have requests
    expect(screen.getByRole('tab', { name: /Declined 1/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Cancelled/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Declined 1/ }))
    expect(screen.getAllByText('VR-2026-00008')).toHaveLength(1)
    expect(screen.queryByText('Requested by')).not.toBeInTheDocument()
  })

  it('requester with no requests gets a welcome, the week strip and the request button', () => {
    const iso = (d) => d.toLocaleDateString('en-CA')
    const now = new Date()
    const day = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
    const tomorrow8 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8).toISOString()
    renderApp(<RequestList />, {
      me: meWith(REQUESTER), path: '/requests',
      data: {
        '["/vehicle-requests/",{"page_size":100}]': { count: 0, results: [] },
        [JSON.stringify(['/vehicle-requests/availability/', { date_from: iso(day(0)), date_to: iso(day(6)) }])]: {
          offices: [{ id: 2, code: 'TAR', name: 'Tarlac', vehicles: 1 }],
          slots: [{ office: 2, start: tomorrow8, end: tomorrow8, status: 'SCHEDULED', vehicle: 5 }] },
        '["/notifications/",{"page":1,"page_size":3}]': { count: 0, results: [] },
      },
    })
    expect(screen.getByRole('heading', { name: 'No requests yet' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Request a vehicle' })).toHaveLength(1)
    expect(screen.getByLabelText(/0 of 1 vehicles free$/)).toBeInTheDocument()  // tomorrow is full: not clickable
    fireEvent.click(screen.getAllByRole('button', { name: /1 of 1 vehicles free\. Request a vehicle for this day/ })[1])  // day after tomorrow
    expect(screen.getByLabelText(/date and time needed/i)).toHaveValue(`${iso(day(2))}T08:00`)
  })

  it('approver keeps the queue with status cards', () => {
    renderApp(<RequestList />, {
      me: meWith(APPROVER), path: '/requests',
      data: {
        '["/vehicle-requests/",{"page":1}]': { count: 1, results: [base] },
        '["/vehicle-requests/summary/",{}]': { total: 1, pending: 1, approved: 0, dispatched: 0, completed: 0, declined: 0, cancelled: 0 },
      },
    })
    expect(screen.getByRole('heading', { name: 'Vehicle requests' })).toBeInTheDocument()
    expect(screen.getByText('Requested by')).toBeInTheDocument()
  })
})

describe('vehicle schedule', () => {
  it('marks booked days in the grid without trip details', async () => {
    const { default: Schedule } = await import('./Schedule')
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    const weeks = Math.ceil((first.getDay() + new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) / 7)
    const start = new Date(now.getFullYear(), now.getMonth(), 1 - first.getDay())
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + weeks * 7 - 1)
    const iso = (d) => d.toLocaleDateString('en-CA')
    const at = (h) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).toISOString()
    const data = { offices: [{ id: 2, code: 'TAR', name: 'Tarlac', vehicles: 2 }],
                   slots: [{ office: 2, start: at(8), end: at(10), status: 'SCHEDULED', vehicle: 5, plate_number: 'SAB 1234', vehicle_label: 'Toyota Innova' },
                           { office: 2, start: at(13), end: at(17), status: 'SCHEDULED', vehicle: 5, plate_number: 'SAB 1234', vehicle_label: 'Toyota Innova' },
                           { office: 9, start: at(8), end: null, status: 'SCHEDULED', vehicle: 7, plate_number: 'FAR 1', vehicle_label: 'X' }] }  // other office: ignored
    renderApp(<Schedule />, { me: meWith(REQUESTER),
      data: { [JSON.stringify(['/vehicle-requests/availability/', { date_from: iso(start), date_to: iso(end) }])]: data } })
    // Both views are in the DOM (jsdom applies no CSS): the desktop grid and the phone month + today's list.
    expect(screen.getAllByText('1 of 2 free')).toHaveLength(2)  // one vehicle twice is still one booked
    expect(screen.getAllByText('SAB 1234')).toHaveLength(4)
    expect(screen.getAllByText('Toyota Innova')).toHaveLength(4)
    expect(screen.queryByText('FAR 1')).toBeNull()

    // phone: today's dot button says how many are free; picking another day lists that day instead
    const dayLong = (d) => d.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })
    expect(screen.getByRole('button', { name: `${dayLong(now)}: 1 of 2 vehicles free` })).toHaveAttribute('aria-pressed', 'true')
    const other = new Date(now.getFullYear(), now.getMonth(), now.getDate() === 1 ? 2 : 1)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${dayLong(other)}(:|$)`) }))
    expect(screen.getAllByText('SAB 1234')).toHaveLength(2) // only the desktop grid still shows them
    fireEvent.click(screen.getByRole('button', { name: `${dayLong(now)}: 1 of 2 vehicles free` }))
    expect(screen.getByRole('button', { name: /Request a vehicle for this day/ })).toBeInTheDocument()

    // a free day opens the request form for that day; past days cannot be picked
    const label = (d) => `Request a vehicle on ${d.toLocaleDateString('en-PH', { dateStyle: 'long' })}`
    if (now.getDate() > 1) expect(screen.queryByRole('button', { name: label(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: label(now) }))
    expect((await screen.findByLabelText(/Date and time needed/)).value.slice(0, 10)).toBe(iso(now))
  })
})
