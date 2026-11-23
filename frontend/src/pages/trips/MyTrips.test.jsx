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
    const booked = trip(2, 'SCHEDULED', { departed_at: null, scheduled_departure: new Date(Date.now() + 864e5).toISOString() })
    renderApp(<MyTrips />, {
      me: meWith(['operations.drive_trip']),
      data: {
        '["/trips/",{"status":"DISPATCHED","page_size":20}]': page([out]),
        '["/trips/",{"status":"SCHEDULED","ordering":"scheduled_departure","page_size":20}]': page([booked]),
        '["/trips/",{"page":1}]': page([out, booked]),
      },
    })
    expect(screen.getByRole('button', { name: 'Record return' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Coming up' })).toBeInTheDocument()
    expect(screen.getAllByText('Town 2').length).toBeGreaterThan(0)
  })
})
