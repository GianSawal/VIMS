import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { meWith, renderApp } from '../../test/render'
import TripCalendar from './TripCalendar'

const iso = (d) => d.toLocaleDateString('en-CA')

describe('Trip calendar day picking', () => {
  it('books today or later, not past days', () => {
    const now = new Date()
    const onPickDay = vi.fn()
    renderApp(<TripCalendar month={iso(now).slice(0, 7)} onMonth={() => {}} filters={{}} onPickDay={onPickDay} />, { me: meWith([]) })
    const label = (d) => `Schedule a trip on ${d.toLocaleDateString('en-PH', { dateStyle: 'long' })}`
    fireEvent.click(screen.getByRole('button', { name: label(now) }))
    expect(onPickDay).toHaveBeenCalledWith(iso(now))
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    expect(screen.queryByRole('button', { name: label(yesterday) })).toBeNull()
  })

  it('has no pick buttons without onPickDay', () => {
    renderApp(<TripCalendar month="" onMonth={() => {}} filters={{}} />, { me: meWith([]) })
    expect(screen.queryByRole('button', { name: /Schedule a trip on/ })).toBeNull()
  })
})
