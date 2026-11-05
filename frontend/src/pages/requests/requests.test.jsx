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

  it('requester with no requests gets a welcome and the request button', () => {
    renderApp(<RequestList />, {
      me: meWith(REQUESTER), path: '/requests',
      data: { '["/vehicle-requests/",{"page_size":100}]': { count: 0, results: [] } },
    })
    expect(screen.getByRole('heading', { name: 'No requests yet' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /request a vehicle/i })).toHaveLength(2)
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
