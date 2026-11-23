import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { meWith, renderApp } from '../../test/render'
import Users, { ROLES } from './Users'

describe('Users page', () => {
  it('renders a role card for every role (a role without a card blanked the page)', () => {
    const users = { count: 1, results: [{ id: 1, username: 'ggomez', first_name: 'Gilbert', last_name: 'Gomez', email: '', is_active: true,
      role_name: 'Driver', driver_id: 7, driver_name: 'Gilbert G. Gomez', offices: [], office_details: [], last_login: null }] }
    renderApp(<Users />, {
      me: meWith(['accounts.view_user', 'accounts.change_user', 'accounts.add_user']),
      data: { '["/users/",{"page":1,"search":"","groups__name":"","is_active":""}]': users, '["/users/",{"page_size":500}]': users },
    })
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByText('Drivers')).toBeInTheDocument()
    expect(ROLES).toContain('Driver')
    expect(screen.getByText('Driver record: Gilbert G. Gomez')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit ggomez' }))
    expect(screen.getByLabelText('New temporary password')).toHaveValue('') // blank keeps the current password
  })

  it('asks which driver a new Driver login belongs to', async () => {
    const drivers = { count: 2, results: [
      { id: 7, full_name: 'Gilbert G. Gomez', office_code: 'RO3', employee_number: null, account_id: null },
      { id: 8, full_name: 'Has Login', office_code: 'RO3', employee_number: null, account_id: 99 },
    ] }
    const users = { count: 0, results: [] }
    renderApp(<Users />, {
      me: meWith(['accounts.view_user', 'accounts.change_user', 'accounts.add_user']),
      data: { '["/users/",{"page":1,"search":"","groups__name":"","is_active":""}]': users, '["/users/",{"page_size":500}]': users,
        '["/drivers/",{"is_active":"true","page_size":500}]': drivers },
    })
    fireEvent.click(screen.getByRole('button', { name: /Add user/ }))
    expect(screen.queryByLabelText('Driver *')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Role'))
    fireEvent.click(screen.getByRole('option', { name: 'Driver' }))
    fireEvent.click(await screen.findByLabelText('Driver *'))
    expect(screen.getByRole('option', { name: /Gilbert G\. Gomez · RO3/ })).toBeInTheDocument()
    expect(screen.queryByText(/Has Login/)).not.toBeInTheDocument() // already linked to another login
  })
})
