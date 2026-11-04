import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { meWith, renderApp } from '../test/render'
import Dashboard from './Dashboard'

const today = '2026-11-04'
const dashboard = (dispatch) => ({ month: '2026-11', office: null, today, activity: [], ...(dispatch && { dispatch }) })

function show(perms, data) {
  renderApp(<Dashboard />, { me: meWith(perms), path: '/', data: { '["/dashboard/",{}]': data } })
}

describe('dashboard Today section', () => {
  it('fleet desk: action counts link to the filtered lists', () => {
    show(['operations.view_trip'], dashboard({ needs_driver: 2, due_today: 1, overdue: 1, pending_requests: 3, low_rfid: 0, low_rfid_below: 500 }))
    const link = (name) => screen.getByRole('link', { name: new RegExp(name) }).getAttribute('href')
    expect(link('Requests to approve')).toBe('/requests?progress=PENDING')
    expect(link('Trips without a driver')).toBe('/trips?needs_driver=true')
    expect(link('To dispatch today')).toBe(`/trips?status=SCHEDULED&view=list&date_from=${today}&date_to=${today}`)
    expect(link('Overdue returns')).toBe('/trips?overdue=true')
    expect(link('RFID below')).toBe('/rfid?low_balance=true')
  })

  it('is hidden without trip access', () => {
    show([], dashboard())
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })
})
