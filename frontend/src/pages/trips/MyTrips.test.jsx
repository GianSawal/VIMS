import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, meWith } from '../../test/render'
import MyTrips from './MyTrips'

const trip = (id, status, extra = {}) => ({
  id, status, ticket_number: `PP-1126-0${id}`, plate_number: `ABC ${id}`, vehicle_label: 'Toyota Innova', vehicle_photo_url: null,
  origin: 'Regional Office', destination: `Town ${id}`, departed_at: new Date().toISOString(), scheduled_departure: null,
  returned_at: null, distance_km: null, odometer_start: 1000, ...extra,
})
const page = (results) => ({ count: results.length, results })

describe('My trips (driver account)', () => {
  it('lists the trip out now with a Record return button and the booked ones', () => {
    const out = trip(1, 'DISPATCHED')
    const booked = trip(2, 'SCHEDULED', { departed_at: null, scheduled_departure: new Date(Date.now() + 864e5).toISOString(), schedule_day: 'UPCOMING' })
    const today = trip(3, 'SCHEDULED', { departed_at: null, scheduled_departure: new Date(Date.now() + 36e5).toISOString(), schedule_day: 'TODAY' })
    const home = { driver: { full_name: 'Pedro', license_number: 'N01-23', license_type: 'Professional', license_expiry_date: '2026-12-01',
      license_status: 'EXPIRING', license_days_left: 8 }, month: { trips: 4, distance_km: 320 },
      vehicles: [{ id: 5, plate_number: 'ABC 1', label: 'Toyota Innova', photo_url: null, current_odometer: 12000, status: 'In Use',
        documents: [{ type: 'LTO Registration', expiry_date: '2026-11-20', expired: true }], maintenance: [] }] }
    renderApp(<MyTrips />, {
      me: meWith(['operations.drive_trip']),
      data: {
        '["/trips/",{"status":"DISPATCHED","page_size":20}]': page([out]),
        '["/trips/",{"status":"SCHEDULED","ordering":"scheduled_departure","page_size":20}]': page([today, booked]),
        '["/driver/home/"]': home,
        '["/trips/",{"page":1}]': page([out, booked]),
      },
    })
    expect(screen.getByRole('button', { name: 'Record return' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Coming up' })).toBeInTheDocument()
    expect(screen.getAllByText('Town 2').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Add fuel' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Start trip' })).toHaveLength(1) // only the one leaving today
    expect(screen.getByText('Expires in 8 days')).toBeInTheDocument()
    expect(screen.getByText(/4 trips completed/)).toBeInTheDocument()
    expect(screen.getByText(/LTO Registration expired/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument()
  })
})
