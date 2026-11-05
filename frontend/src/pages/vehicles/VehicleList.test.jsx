import { act, fireEvent, screen } from '@testing-library/react'
import { Route } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meWith, renderApp } from '../../test/render'
import VehicleList from './VehicleList'

const car = (i) => ({ id: i, plate_number: `PLT ${i}`, make: 'Toyota', model: 'Innova', vehicle_type: 'SUV', vehicle_type_display: 'SUV',
                      office_code: 'RO3', status: 'SERVICEABLE', status_display: 'Serviceable', current_odometer: 0, photo_url: null })

afterEach(() => vi.useRealTimers())

describe('vehicle list paging', () => {
  it('stays on page 2 after Next (the search debounce must not reset it)', () => {
    vi.useFakeTimers()
    renderApp(null, {
      me: meWith(['fleet.view_vehicle']), path: '/vehicles',
      routes: <Route path="/vehicles" element={<VehicleList />} />,
      data: {
        '["/vehicles/",{"page":1}]': { count: 10, results: [1, 2, 3, 4, 5, 6, 7, 8].map(car) },
        '["/vehicles/",{"page":2}]': { count: 10, results: [9, 10].map(car) },
      },
    })
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Next page'))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('PLT 9')).toBeInTheDocument()
  })
})
