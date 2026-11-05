import { screen } from '@testing-library/react'
import { Route } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { meWith, renderApp } from '../../test/render'
import { ReportPage } from './Reports'

const meta = { slug: 'driver-assignment', title: 'Driver Assignment', group: 'Drivers', description: '', filters: ['office', 'vehicle', 'driver', 'status', 'period'],
               required: [], default_period: true, period_label: 'Date', statuses: [{ value: 'ACTIVE', label: 'Active' }], group_by: [] }

describe('report page', () => {
  it('reads option lists cached by other pages ({count, results} under the same key)', () => {
    renderApp(null, {
      me: meWith([], { view_all_offices: true }), path: '/reports/driver-assignment',
      routes: <Route path="/reports/:slug" element={<ReportPage />} />,
      data: {
        '["/reports/"]': [meta],
        // useList('/offices/', { page_size: 500 }) elsewhere (e.g. the Vehicles office filter) fills this key first
        '["/offices/",{"page_size":500}]': { count: 1, results: [{ id: 1, code: 'RO3', name: 'Regional Office' }] },
        '["/vehicles/",{"page_size":500}]': { count: 1, results: [{ id: 2, plate_number: 'SAA 3316', make: 'Isuzu', model: 'Crosswind' }] },
        '["/drivers/",{"page_size":500}]': { count: 1, results: [{ id: 3, full_name: 'Juan Cruz' }] },
      },
    })
    expect(screen.getByRole('heading', { name: 'Driver Assignment' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'RO3 - Regional Office', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Juan Cruz', hidden: true })).toBeInTheDocument()
  })
})
