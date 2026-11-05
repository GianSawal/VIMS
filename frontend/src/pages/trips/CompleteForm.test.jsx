import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '../../api'
import { meWith, renderApp } from '../../test/render'
import { CompleteForm } from './TripDetail'

const trip = { id: 9, ticket_number: 'TT-2026-00009', vehicle: 5, plate_number: 'SAB 1234', vehicle_label: 'Toyota Innova',
               destination: 'Tarlac City', odometer_start: 1000, remarks: '', status: 'DISPATCHED' }
const account = { id: 3, provider: 'EASYTRIP', masked_account: '•••• 0123', vehicle: 5, plate_number: 'SAB 1234',
                  vehicle_label: 'Toyota Innova', is_active: true, current_balance: '1250.00' }
const PERMS = ['operations.change_trip', 'operations.add_tolltransaction']

function show(perms = PERMS) {
  return renderApp(<CompleteForm trip={trip} onClose={() => {}} />, {
    me: meWith(perms),
    data: {
      '["/rfid-accounts/",{"page_size":500}]': { count: 1, results: [account] },
      '["/vehicles/",{"page_size":500}]': { count: 0, results: [] },
      '["/trips/",{"vehicle":"5","page_size":50}]': { count: 1, results: [trip] },
    },
  })
}

describe('Record return', () => {
  it('goes on to the toll form with the vehicle account and its balance', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { ...trip, status: 'COMPLETED' } })
    show()
    fireEvent.change(screen.getByLabelText(/Ending odometer/), { target: { value: '1080' } })
    fireEvent.click(screen.getByLabelText(/Record toll for this trip/))
    fireEvent.click(screen.getByRole('button', { name: 'Complete and record toll' }))

    expect(await screen.findByText(/Now record the tolls/)).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith('/trips/9/complete/', expect.objectContaining({ odometer_end: 1080 }))
    expect(await screen.findByText(/from the account/)).toBeInTheDocument()  // account auto-picked, vehicle locked to it
    expect(screen.getByText('(linked)')).toBeInTheDocument()
    expect(screen.getByText(/1,250\.00/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Charge 1 amount'), { target: { value: '300' } })
    expect(screen.getByText(/950\.00/)).toBeInTheDocument()
  })

  it('has no toll option without permission to record tolls', () => {
    show(['operations.change_trip'])
    expect(screen.queryByLabelText(/Record toll for this trip/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete trip' })).toBeInTheDocument()
  })
})
