import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { meWith, renderApp } from '../../test/render'
import DispatchForm from './DispatchForm'

const vehicle = { id: 5, plate_number: 'SAB 1234', make: 'Toyota', model: 'Innova', status: 'SERVICEABLE',
                  current_odometer: 1000, office_name: 'DOLE Regional Office III' }
const show = (offices) => renderApp(<DispatchForm mode="schedule" vehicle={vehicle} onClose={() => {}} />,
  { me: meWith(['operations.add_trip'], { offices }) })

const origin = () => document.getElementById('origin-search')

describe('Origin with the map off', () => {
  it("starts as the user's office", async () => {
    show([{ id: 3, code: 'BUL', name: 'Bulacan Provincial Office' }])
    await waitFor(() => expect(origin()).toHaveValue('Bulacan Provincial Office'))
  })

  it("falls back to the vehicle's office and keeps what the user types", async () => {
    show([])
    await waitFor(() => expect(origin()).toHaveValue('DOLE Regional Office III'))
    fireEvent.change(origin(), { target: { value: 'Malolos City Hall' } })
    expect(origin()).toHaveValue('Malolos City Hall')
  })
})
