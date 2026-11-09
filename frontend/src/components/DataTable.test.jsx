import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DataTable from './DataTable'

const columns = [{ key: 'plate_number', label: 'Plate' }, { key: 'status', label: 'Status', render: (r) => r.status.toLowerCase() }]
const page = (results, count = results.length) => ({ data: { count, results }, isLoading: false, isError: false })

describe('DataTable', () => {
  it('renders rows with custom cells and the count', () => {
    render(<DataTable columns={columns} query={page([{ id: 1, plate_number: 'ABC 1234', status: 'SERVICEABLE' }])} />)
    expect(screen.getByRole('cell', { name: 'ABC 1234' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'serviceable' })).toBeInTheDocument()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–1 of 1')
  })

  it('shows the empty message and the API error', () => {
    const { rerender } = render(<DataTable columns={columns} query={page([])} empty="No vehicles yet." />)
    expect(screen.getByText('No vehicles yet.')).toBeInTheDocument()
    rerender(<DataTable columns={columns} query={{ isError: true, error: { response: { data: { detail: 'Server busy.' } } } }} />)
    expect(screen.getByText('Server busy.')).toBeInTheDocument()
  })

  it('pages through results', async () => {
    const onPage = vi.fn()
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: i + 9, plate_number: `P ${i}`, status: 'IN_USE' }))
    render(<DataTable columns={columns} query={page(rows, 20)} page={2} onPage={onPage} />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 9–16 of 20')  // 8 per page
    await userEvent.click(screen.getByLabelText('Next page'))
    await userEvent.click(screen.getByLabelText('Previous page'))
    expect(onPage.mock.calls).toEqual([[3], [1]])
  })

  it('disables paging at the ends', () => {
    render(<DataTable columns={columns} query={page([{ id: 1, plate_number: 'A', status: 'IN_USE' }])} page={1} onPage={() => {}} />)
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })

  it('opens a row on click', async () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={columns} query={page([{ id: 9, plate_number: 'XYZ 9', status: 'IN_USE' }])} onRowClick={onRowClick} />)
    await userEvent.click(screen.getByText('XYZ 9'))
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }))
  })

  it('with mobileCard: cards for phones, the table kept for md and up', async () => {
    const onRowClick = vi.fn()
    const { container } = render(<DataTable columns={columns} query={page([{ id: 4, plate_number: 'CAR 4', status: 'IN_USE' }])}
      onRowClick={onRowClick} mobileCard={(r) => <span>Card {r.plate_number}</span>} />)
    expect(container.querySelector('table').parentElement).toHaveClass('hidden', 'md:block')
    expect(screen.getByText('Card CAR 4').closest('.md\\:hidden')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Card CAR 4'))
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }))
  })

  it('without mobileCard the table shows at every width', () => {
    const { container } = render(<DataTable columns={columns} query={page([{ id: 5, plate_number: 'CAR 5', status: 'IN_USE' }])} />)
    expect(container.querySelector('table').parentElement).not.toHaveClass('hidden')
    expect(container.querySelector('.md\\:hidden')).toBeNull()
  })
})
