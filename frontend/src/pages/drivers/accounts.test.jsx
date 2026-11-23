import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { meWith, renderApp } from '../../test/render'
import { DriverLogin } from './accounts'

const driver = { id: 7, full_name: 'Daniel D. Dione', office_code: 'RO3', is_active: true, account_id: null, account_username: null }

describe('Driver account', () => {
  it('Create account asks for a username and an initial password (both optional)', () => {
    renderApp(<DriverLogin driver={driver} />, { me: meWith(['accounts.add_user', 'accounts.change_user']) })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByLabelText('Username')).toHaveValue('')
    expect(screen.getByLabelText('Initial password')).toHaveAttribute('type', 'password')
  })

  it('shows the username once the driver has an account, and nothing to create without the permission', () => {
    const { unmount } = renderApp(<DriverLogin driver={{ ...driver, account_id: 3, account_username: 'daniel_dione' }} />,
      { me: meWith(['accounts.add_user']) })
    expect(screen.getByText('daniel_dione')).toBeInTheDocument()
    unmount()
    renderApp(<DriverLogin driver={driver} />, { me: meWith([]) })
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument()
  })
})
