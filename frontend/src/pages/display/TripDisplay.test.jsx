import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../../test/render'
import TripDisplay from './TripDisplay'

const soon = new Date(Date.now() + 3 * 36e5).toISOString()
const trip = (ticket, status, extra = {}) => ({
  ticket_number: ticket, status, plate_number: `P ${ticket}`, vehicle_label: 'Toyota', destination: `To ${ticket}`, purpose: '',
  driver_name: 'Juan', scheduled_departure: soon, departed_at: null, returned_at: null, scheduled_return: null, flag: null, ...extra,
})
const board = (today, upcoming = []) => ({ office: { name: 'RO' }, generated_at: new Date().toISOString(), today, upcoming })

describe('TV board', () => {
  it('tags only trips whose status changed since the last refresh', async () => {
    const { qc } = renderApp(<TripDisplay />, {
      path: '/display?token=abc',
      data: { '["display","abc"]': board([trip('T1', 'SCHEDULED'), trip('T2', 'SCHEDULED')]) },
    })
    expect(screen.queryByText('Just left')).not.toBeInTheDocument() // first load: nothing is "new"

    const out = trip('T1', 'DISPATCHED', { departed_at: new Date().toISOString() })
    act(() => qc.setQueryData(['display', 'abc'], board([out, trip('T2', 'SCHEDULED')], [trip('T3', 'SCHEDULED')])))
    expect(await screen.findByText('Just left')).toBeInTheDocument()
    expect(screen.getByText('New booking')).toBeInTheDocument() // T3 appeared
    expect(screen.getAllByText(/Just left|New booking|Just returned/)).toHaveLength(2) // T2 unchanged
  })
})
