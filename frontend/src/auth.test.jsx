import { screen } from '@testing-library/react'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RequireAuth, RequirePerm } from './auth'
import Layout from './Layout'
import { meWith, renderApp } from './test/render'

const unread = { '["/notifications/unread-count/"]': 3 }
const navLabels = () => screen.getAllByRole('link').map((a) => a.textContent.trim())

describe('navigation follows the role (hint only; the API enforces it)', () => {
  it('Viewer sees records but no administration', () => {
    renderApp(null, {
      me: meWith(['fleet.view_vehicle', 'fleet.view_driver', 'operations.view_trip', 'accounts.view_office']),
      data: unread, routes: <Route path="*" element={<Layout />} />,
    })
    const labels = navLabels()
    expect(labels).toEqual(expect.arrayContaining(['Dashboard', 'Vehicles', 'Drivers', 'Trips', 'Reports', 'Offices']))
    expect(labels.some((l) => l.startsWith('Users') || l.startsWith('Audit') || l.startsWith('Data Import'))).toBe(false)
    expect(screen.getByText('3')).toBeInTheDocument() // unread badge on Notifications
  })

  it('System Administrator (superuser) sees every module', () => {
    renderApp(null, { me: meWith([], { is_superuser: true, role: 'System Administrator' }), data: unread,
                      routes: <Route path="*" element={<Layout />} /> })
    expect(navLabels()).toEqual(expect.arrayContaining(['Users', 'Audit Logs', 'Data Import', 'RFID / Toll']))
  })

  it('a user without a role sees only the dashboard, notifications and password', () => {
    renderApp(null, { me: meWith([], { role: null }), data: unread, routes: <Route path="*" element={<Layout />} /> })
    expect(navLabels().map((l) => l.replace(/\d+$/, ''))).toEqual(['Dashboard', 'Notifications', 'Password'])
    expect(screen.getByText('No role assigned')).toBeInTheDocument()
  })
})

describe('route guards', () => {
  const routes = (
    <>
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/change-password" element={<p>change password page</p>} />
      <Route element={<RequireAuth />}>
        <Route element={<RequirePerm perm="audit.view_auditlog" />}>
          <Route path="/audit-logs" element={<p>audit page</p>} />
        </Route>
        <Route path="/dashboard" element={<p>dashboard page</p>} />
      </Route>
    </>
  )

  it('sends a logged-out visitor to the login page', () => {
    renderApp(null, { me: null, path: '/dashboard', routes })
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('forces a pending password change first', () => {
    renderApp(null, { me: meWith([], { must_change_password: true }), path: '/dashboard', routes })
    expect(screen.getByText('change password page')).toBeInTheDocument()
  })

  it('shows 403 for a page the role may not open', () => {
    renderApp(null, { me: meWith(['fleet.view_vehicle']), path: '/audit-logs', routes })
    expect(screen.getByText('403')).toBeInTheDocument()
    expect(screen.queryByText('audit page')).not.toBeInTheDocument()
  })

  it('opens it with the permission', () => {
    renderApp(null, { me: meWith(['audit.view_auditlog']), path: '/audit-logs', routes })
    expect(screen.getByText('audit page')).toBeInTheDocument()
  })
})
