import { screen } from '@testing-library/react'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import Layout from './Layout'
import { meWith, renderApp } from './test/render'

const admin = meWith(['operations.view_trip', 'fleet.view_vehicle', 'notifications.view_notification'],
  { first_name: 'Ana', last_name: 'Reyes', role: 'System Administrator', view_all_offices: true })

const show = (path, me = admin) => renderApp(null, {
  me, path, data: { '["/notifications/unread-count/"]': 3 },
  routes: <Route element={<Layout />}><Route path="*" element={<p>page</p>} /></Route>,
})

describe('phone header', () => {
  it('list page: menu button, page name, office chip, bell with unread count, account menu', () => {
    show('/trips')
    const header = screen.getAllByRole('banner').at(-1)
    expect(header).toHaveTextContent('Trips')
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    expect(screen.getByText('All offices')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toHaveAttribute('href', '/notifications')
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument() // inside the (closed) account popover
  })

  it('detail page: back to the list instead of the menu', () => {
    show('/trips/12')
    expect(screen.getByRole('button', { name: 'Back to Trips' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument()
  })

  it('no office chip for a single-office user', () => {
    show('/trips', { ...admin, view_all_offices: false, offices: [{ id: 1, code: 'RO3', name: 'Regional Office III' }] })
    expect(screen.queryByText('All offices')).not.toBeInTheDocument()
  })
})
