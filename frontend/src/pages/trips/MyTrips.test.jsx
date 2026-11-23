import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, meWith } from '../../test/render'
import MyTrips from './MyTrips'
import MyProfile from './MyProfile'
import MyTripHistory from './MyTripHistory'

const trip = (id, status, extra = {}) => ({
  id, status, ticket_number: `PP-1126-0${id}`, plate_number: `ABC ${id}`, vehicle_label: 'Toyota Innova', vehicle_photo_url: null,
  origin: 'Regional Office', destination: `Town ${id}`, departed_at: new Date().toISOString(), scheduled_departure: null,
  returned_at: null, distance_km: null, odometer_start: 1000, ...extra,
})
const page = (results) => ({ count: results.length, results })
const home = {
  driver: { full_name: 'Pedro Penduko', office_code: 'RO3', office_name: 'Regional Office III', username: 'ppenduko', employee_number: 'E-1',
    contact_number: '', license_number: 'N01-23', license_type: 'Professional', license_restrictions: '1,2', license_issue_date: null,
    license_expiry_date: '2026-12-01', license_status: 'EXPIRING', license_days_left: 8 },
  month: { trips: 4, distance_km: 320 }, year: { trips: 40, distance_km: 3200 },
  vehicles: [{ id: 5, plate_number: 'ABC 1', label: 'Toyota Innova', photo_url: null, current_odometer: 12000, status: 'In Use',
    documents: [{ type: 'LTO Registration', expiry_date: '2026-11-20', expired: true }], maintenance: [] }],
}
const DRIVER = meWith(['operations.drive_trip'], { first_name: 'Pedro' })

describe('Driver pages', () => {
  it('Today: the trip out now and the one leaving today, each with its action; warnings on top', () => {
    const later = trip(2, 'SCHEDULED', { departed_at: null, scheduled_departure: new Date(Date.now() + 3 * 864e5).toISOString(), schedule_day: 'UPCOMING' })
    const today = trip(3, 'SCHEDULED', { departed_at: null, scheduled_departure: new Date(Date.now() + 36e5).toISOString(), schedule_day: 'TODAY' })
    renderApp(<MyTrips />, {
      me: DRIVER,
      data: {
        '["/trips/",{"status":"DISPATCHED","page_size":20}]': page([trip(1, 'DISPATCHED')]),
        '["/trips/",{"status":"SCHEDULED","ordering":"scheduled_departure","page_size":20}]': page([today, later]),
        '["/driver/home/"]': home,
      },
    })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Pedro/)
    expect(screen.getByRole('button', { name: 'Record return' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add fuel' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Start trip' })).toHaveLength(1) // only the one leaving today
    expect(screen.getByRole('heading', { name: 'Coming up' })).toBeInTheDocument()
    expect(screen.getByText(/Your license: expires in 8 days/)).toBeInTheDocument()
    expect(screen.getByText(/ABC 1: LTO Registration expired/)).toBeInTheDocument()
  })

  it('Today with nothing to do says when the next trip is', () => {
    const later = trip(2, 'SCHEDULED', { departed_at: null, scheduled_departure: new Date(Date.now() + 3 * 864e5).toISOString(), schedule_day: 'UPCOMING' })
    renderApp(<MyTrips />, {
      me: DRIVER,
      data: {
        '["/trips/",{"status":"DISPATCHED","page_size":20}]': page([]),
        '["/trips/",{"status":"SCHEDULED","ordering":"scheduled_departure","page_size":20}]': page([later]),
        '["/driver/home/"]': { ...home, driver: { ...home.driver, license_status: 'VALID' }, vehicles: [] },
      },
    })
    expect(screen.getByText('No trip today.')).toBeInTheDocument()
    expect(screen.getByText(/Next: .* to Town 2/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Needs attention' })).not.toBeInTheDocument()
  })

  it('My profile: record, license, totals, account, vehicles and the correction request', () => {
    renderApp(<MyProfile />, { me: DRIVER, data: { '["/driver/home/"]': home } })
    expect(screen.getByText('E-1')).toBeInTheDocument()
    expect(screen.getByText('N01-23')).toBeInTheDocument()
    expect(screen.getByText('Expires in 8 days')).toBeInTheDocument()
    expect(screen.getByText(/40 trips/)).toBeInTheDocument()
    expect(screen.getByText('ppenduko')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Change password/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Report a problem/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Request a correction/ })).toBeInTheDocument()
  })

  it('Trip history filters by month', () => {
    renderApp(<MyTripHistory />, {
      me: DRIVER, path: '/my-trips/history?month=2026-02',
      data: {
        '["/trips/",{"page":1,"date_from":"2026-02-01","date_to":"2026-02-28"}]': page([trip(7, 'COMPLETED', { distance_km: 120 })]),
        '["/trips/summary/",{"date_from":"2026-02-01","date_to":"2026-02-28"}]': { total: 1, distance_km: 120, by_status: { COMPLETED: 1 } },
      },
    })
    expect(screen.getByLabelText('Month')).toHaveValue('2026-02')
    expect(screen.getByText(/1 completed/)).toBeInTheDocument()
    expect(screen.getAllByText('Town 7').length).toBeGreaterThan(0)
  })
})
