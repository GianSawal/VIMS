import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { meWith, renderApp } from '../../test/render'
import Users, { ROLES } from './Users'

describe('Users page', () => {
  it('renders a role card for every role (a role without a card blanked the page)', () => {
    const users = { count: 1, results: [{ id: 1, username: 'ggomez', first_name: 'Gilbert', last_name: 'Gomez', email: '', is_active: true,
      role_name: 'Driver', offices: [], office_details: [], last_login: null }] }
    renderApp(<Users />, {
      me: meWith(['accounts.view_user', 'accounts.change_user', 'accounts.add_user']),
      data: { '["/users/",{"page":1,"search":"","groups__name":"","is_active":""}]': users, '["/users/",{"page_size":500}]': users },
    })
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByText('Drivers')).toBeInTheDocument()
    expect(ROLES).toContain('Driver')
  })
})
