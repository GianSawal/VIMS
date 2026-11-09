import { render, screen, waitFor } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountUp, Reveal, RevealGroup } from './motion'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const fmt = (v) => peso.format(v)

// Every observed element is reported in view right away.
class InView {
  constructor(cb) { this.cb = cb }
  observe(target) { queueMicrotask(() => this.cb([{ target, isIntersecting: true, intersectionRatio: 1 }], this)) }
  unobserve() {}
  disconnect() {}
}

afterEach(() => vi.unstubAllGlobals())

describe('CountUp', () => {
  it('renders the exact final text at once without IntersectionObserver', () => {
    render(<CountUp value="1234.50" format={fmt} />)
    expect(screen.getByText('₱1,234.50')).toBeInTheDocument()
  })

  it('counts up from zero and ends on the exact formatted value', async () => {
    vi.stubGlobal('IntersectionObserver', InView)
    const { container } = render(<CountUp value="1234.50" format={fmt} duration={0.05} />)
    const el = container.firstChild
    expect(el).toHaveTextContent('₱0.00')
    await waitFor(() => expect(el).toHaveTextContent('₱1,234.50'))
    expect(el.style.minWidth).toBe('')
  })

  it('shows a value that arrives mid-count instead of replaying', async () => {
    vi.stubGlobal('IntersectionObserver', InView)
    const { container, rerender } = render(<CountUp value={500} format={String} duration={0.3} />)
    rerender(<CountUp value={7} format={String} duration={0.3} />)
    await waitFor(() => expect(container.firstChild).toHaveTextContent(/^7$/))
    await new Promise((r) => setTimeout(r, 350))
    expect(container.firstChild).toHaveTextContent(/^7$/)
  })

  it('leaves zero alone and skips counting with reduced motion', () => {
    vi.stubGlobal('IntersectionObserver', InView)
    render(<MotionConfig reducedMotion="always"><CountUp value={42} format={String} /><CountUp value={0} format={fmt} /></MotionConfig>)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('₱0.00')).toBeInTheDocument()
  })
})

describe('Reveal', () => {
  it('renders plain, visible content without IntersectionObserver or with reduced motion', () => {
    render(<RevealGroup as="ul"><Reveal as="li" inherit>Fleet</Reveal></RevealGroup>)
    expect(screen.getByRole('listitem')).not.toHaveAttribute('style')
    vi.stubGlobal('IntersectionObserver', InView)
    render(<MotionConfig reducedMotion="always"><Reveal>Trips</Reveal></MotionConfig>)
    expect(screen.getByText('Trips')).not.toHaveAttribute('style')
  })

  it('fades its content in once in view', async () => {
    vi.stubGlobal('IntersectionObserver', InView)
    render(<Reveal>Fuel</Reveal>)
    await waitFor(() => expect(screen.getByText('Fuel').style.opacity).toBe('1'))
  })
})
