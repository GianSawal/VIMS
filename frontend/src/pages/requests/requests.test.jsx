import { screen } from '@testing-library/react'
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
  it('requester: "My vehicle requests" with status cards and no requester column', () => {
    renderApp(<RequestList />, {
      me: meWith(REQUESTER), path: '/requests',
      data: {
        '["/vehicle-requests/",{"page":1}]': { count: 1, results: [approved] },
        '["/vehicle-requests/summary/",{}]': { total: 1, pending: 0, approved: 1, dispatched: 0, completed: 0, declined: 0, cancelled: 0 },
      },
    })
    expect(screen.getByRole('heading', { name: 'My vehicle requests' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request a vehicle/i })).toBeInTheDocument()
    expect(screen.getByText('VR-2026-00007')).toBeInTheDocument()
    expect(screen.queryByText('Requested by')).not.toBeInTheDocument()
  })
})
