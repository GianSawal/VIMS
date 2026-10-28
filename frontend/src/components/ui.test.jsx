import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, Field } from './ui'

describe('Field', () => {
  it('shows the hint, replaced by the error message', () => {
    const { rerender } = render(<Field label="Plate" htmlFor="p" hint="As on the OR/CR"><input id="p" /></Field>)
    expect(screen.getByLabelText('Plate')).toBeInTheDocument()
    expect(screen.getByText('As on the OR/CR')).toBeInTheDocument()
    rerender(<Field label="Plate" htmlFor="p" hint="As on the OR/CR" error="Already used."><input id="p" /></Field>)
    expect(screen.queryByText('As on the OR/CR')).not.toBeInTheDocument()
    expect(screen.getByText('Already used.')).toHaveClass('text-danger')
  })
})

describe('ConfirmDialog', () => {
  it('confirms or cancels, and blocks a double submit while busy', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(<ConfirmDialog open title="Archive vehicle?" message="It leaves the active list."
      confirmLabel="Archive" danger onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText('It leaves the active list.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<ConfirmDialog open busy title="Archive vehicle?" message="x" confirmLabel="Archive" onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled()
  })
})
