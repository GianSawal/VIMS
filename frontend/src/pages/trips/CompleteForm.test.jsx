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
  vi.restoreAllMocks()
  vi.spyOn(api, 'post').mockResolvedValue({ data: { ...trip, status: 'COMPLETED' } })
  renderApp(<CompleteForm trip={trip} onClose={() => {}} />, {
    me: meWith(perms), data: { '["/rfid-accounts/",{"page_size":500}]': { count: 1, results: [account] } },
  })
  fireEvent.change(screen.getByLabelText(/Ending odometer/), { target: { value: '1080' } })
}

describe('Record return', () => {
  it('records the tolls with the return, on the vehicle account', async () => {
    show()
    expect(await screen.findByDisplayValue(/0123 · SAB 1234/)).toBeInTheDocument()  // account picked from the vehicle
    expect(screen.getByText(/1,250\.00/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Charge 1 amount'), { target: { value: '300' } })
    fireEvent.change(screen.getByLabelText('Charge 1 toll plaza'), { target: { value: 'NLEX Bocaue' } })
    expect(screen.getByText(/950\.00/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Complete trip' }))
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/trips/9/complete/', expect.objectContaining({
      odometer_end: 1080,
      toll: { account: 3, items: [{ kind: 'debit', amount: '300', description: 'NLEX Bocaue', reference_number: '' }] },
    })))
  })

  it('sends no toll when the lines are blank', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Complete trip' }))
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(api.post.mock.calls.at(-1)[1]).not.toHaveProperty('toll')
  })

  it('has no toll section without permission to record tolls', () => {
    show(['operations.change_trip'])
    expect(screen.queryByText(/Toll charges/)).not.toBeInTheDocument()
  })
})
