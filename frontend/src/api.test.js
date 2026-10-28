import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { applyFieldErrors, errorMessage, invalidatePrefix } from './api'

const fail = (status, data) => ({ response: { status, data } })

describe('errorMessage', () => {
  it('explains a lost connection', () => {
    expect(errorMessage(new Error('Network Error'))).toBe('Network error. Please try again.')
  })
  it('says what to do after a server error or a rate limit, never shows the raw page', () => {
    expect(errorMessage(fail(500, '<html>Traceback…</html>'))).toMatch(/^Something went wrong on the server/)
    expect(errorMessage(fail(429, { detail: 'Request was throttled. Expected available in 60 seconds.' })))
      .toBe('Request was throttled. Expected available in 60 seconds.')
  })
  it('uses DRF detail, else joins field messages', () => {
    expect(errorMessage(fail(403, { detail: 'You do not have permission.' }))).toBe('You do not have permission.')
    expect(errorMessage(fail(400, { plate_number: ['Taken.'], office: ['Required.'] }))).toBe('Taken. Required.')
  })
})

describe('applyFieldErrors', () => {
  it('puts each message on its form field and returns the rest', () => {
    const setError = vi.fn()
    const rest = applyFieldErrors(fail(400, { plate_number: ['Already used.'], non_field_errors: ['Vehicle is archived.'] }),
      setError, ['plate_number', 'make'])
    expect(setError).toHaveBeenCalledWith('plate_number', { message: 'Already used.' })
    expect(setError).toHaveBeenCalledTimes(1)
    expect(rest).toBe('Vehicle is archived.')
  })
  it('falls back to the general message for anything but a 400', () => {
    const setError = vi.fn()
    expect(applyFieldErrors(fail(404, { detail: 'Not found.' }), setError, ['make'])).toBe('Not found.')
    expect(setError).not.toHaveBeenCalled()
  })
})

describe('invalidatePrefix', () => {
  it('refreshes lists and details under the given paths only', async () => {
    const qc = new QueryClient()
    for (const key of [['/vehicles/', {}], ['/vehicles/', 7], ['/drivers/', {}], ['me']]) qc.setQueryData(key, 1)
    await invalidatePrefix(qc, '/vehicles/')
    const stale = qc.getQueryCache().getAll().filter((q) => q.state.isInvalidated).map((q) => q.queryKey)
    expect(stale).toEqual([['/vehicles/', {}], ['/vehicles/', 7]])
  })
})
