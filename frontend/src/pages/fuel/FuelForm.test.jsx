import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { meWith, renderApp } from '../../test/render'
import FuelForm from './FuelForm'

const vehicle = { id: 5, plate_number: 'SAB 1234', make: 'Toyota', model: 'Innova', fuel_type: 'DIESEL', current_odometer: 1000 }
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('Fuel total', () => {
  it('fills in liters × price until the user types their own', () => {
    renderApp(<FuelForm vehicle={vehicle} onClose={() => {}} />, { me: meWith(['operations.add_fuelrecord']) })
    const total = screen.getByLabelText(/Total on receipt/)
    type(/Liters/, '40')
    type(/Price per liter/, '84.48')
    expect(total).toHaveValue('3379.20')
    type(/Liters/, '41')
    expect(total).toHaveValue('3463.68')

    type(/Total on receipt/, '3463.50') // the receipt's own figure stays
    type(/Liters/, '42')
    expect(total).toHaveValue('3463.50')

    type(/Total on receipt/, '') // cleared: follows the computation again
    type(/Liters/, '40')
    expect(total).toHaveValue('3379.20')
  })

  it("keeps an existing record's own total", () => {
    const record = { id: 1, vehicle: 5, plate_number: 'SAB 1234', date: '2026-11-18', driver: null, fuel_type: 'DIESEL',
                     liters: '40.000', unit_price: '84.48', total_amount: '3379.00', odometer: 1000, is_full_tank: false,
                     po_number: '', supplier: '', receipt_number: '', remarks: '' }
    renderApp(<FuelForm record={record} onClose={() => {}} />, { me: meWith(['operations.change_fuelrecord']) })
    expect(screen.getByLabelText(/Total on receipt/)).toHaveValue('3379.00')
  })
})
