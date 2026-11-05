import { fireEvent, render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { Select } from './Select'

function Form({ onValue }) {
  const { register, watch } = useForm({ defaultValues: { vehicle: '2' } })
  onValue(watch('vehicle'))
  return (
    <>
      <label htmlFor="v">Vehicle</label>
      <Select id="v" {...register('vehicle')}>
        <option value="">Select a vehicle…</option>
        <option value="1">SAA 3316 · Isuzu Crosswind</option>
        <option value="2">SCD 2643 · Toyota Hiace</option>
        <option value="3" disabled>SCB 1747 · Toyota Innova (booked)</option>
      </Select>
    </>
  )
}

describe('Select', () => {
  it('shows the form value, filters by search and sets the value on pick', () => {
    let value
    render(<Form onValue={(v) => { value = v }} />)
    const box = screen.getByLabelText('Vehicle')
    expect(box).toHaveTextContent('SCD 2643 · Toyota Hiace')  // default from react-hook-form
    fireEvent.click(box)
    fireEvent.change(screen.getByLabelText('Search options'), { target: { value: 'isuzu' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.click(screen.getByRole('option', { name: /SAA 3316/ }))
    expect(value).toBe('1')
    expect(box).toHaveTextContent('SAA 3316')
  })

  it('keeps disabled options unpickable and works controlled', () => {
    let picked = 'x'
    render(
      <Select aria-label="Status" value="" onChange={(e) => { picked = e.target.value }}>
        <option value="">Any</option>
        <option value="A" disabled>Archived</option>
        <option value="B">Active</option>
      </Select>,
    )
    fireEvent.click(screen.getByLabelText('Status'))
    fireEvent.click(screen.getByRole('option', { name: 'Archived' }))
    expect(picked).toBe('x')
    fireEvent.keyDown(screen.getByLabelText('Search options'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByLabelText('Search options'), { key: 'Enter' })
    expect(picked).toBe('B')  // skipped the disabled one
  })
})
