import { useLayoutEffect, useRef } from 'react'
import { animate, inView, motion, useReducedMotionConfig } from 'motion/react'

/*
 * Entrance motion for dashboards and charts: sections rise in as they scroll into view, bars grow from their
 * baseline, numbers count up. Each plays once per mount, so React Query refetches never replay it.
 * Off with reduced motion (everything renders final at once) and without IntersectionObserver (tests, old
 * browsers), so content is never left hidden. Only opacity, transform and clip-path animate: no layout shift.
 */

export const EASE_OUT = [0.23, 1, 0.32, 1]
// Gentler cubic ease-out for fills and counters, so the last part of the sweep stays readable.
export const EASE_FILL = [0.33, 1, 0.68, 1]

export function useEntrance() {
  const reduced = useReducedMotionConfig()
  return !reduced && typeof IntersectionObserver !== 'undefined'
}

const VIEW = { once: true, margin: '0px 0px -40px 0px' }
const grow = (hidden) => ({
  hidden: { clipPath: hidden },
  shown: { clipPath: 'inset(0% 0% 0% 0%)', transition: { duration: 0.6, ease: EASE_OUT } },
})
const VARIANTS = {
  rise: { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } } },
  fade: { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: 0.25, delay: 0.35 } } },
  // Horizontal bars grow left to right, vertical bars bottom to top.
  growX: grow('inset(0% 100% 0% 0%)'),
  growY: grow('inset(100% 0% 0% 0%)'),
}

/**
 * <Reveal> plays its own entrance when scrolled into view. With `inherit` it is an item of the nearest
 * <RevealGroup> and plays in the group's stagger. `variant`: rise (default), fade, growX, growY.
 */
export function Reveal({ as = 'div', variant = 'rise', inherit = false, ...props }) {
  return <Enter as={as} variants={VARIANTS[variant]} trigger={!inherit} {...props} />
}

/** Staggers its `<Reveal inherit>` descendants once the group scrolls into view; the group itself does not move. */
export function RevealGroup({ as = 'div', stagger = 0.05, ...props }) {
  return <Enter as={as} variants={{ hidden: {}, shown: { transition: { staggerChildren: stagger } } }} trigger {...props} />
}

function Enter({ as, variants, trigger, ...props }) {
  const on = useEntrance()
  if (!on) {
    const Tag = as
    return <Tag {...props} />
  }
  const Tag = motion[as]
  return <Tag variants={variants} {...(trigger && { initial: 'hidden', whileInView: 'shown', viewport: VIEW })} {...props} />
}

/**
 * A number that counts up from 0 to `value` the first time it scrolls into view, rendered through `format`
 * (format(value) is the exact final text). Integers count in whole steps; decimals keep the value's own places
 * ('1234.50' -> 2). Zero, non-numbers and later value changes render as is.
 * Frames write React's own text node (no re-render per frame); the box keeps its final width while counting.
 */
export function CountUp({ value, format = String, duration = 0.8 }) {
  const ref = useRef(null)
  const final = format(value)
  const latest = useRef(final)
  const on = useEntrance()
  useLayoutEffect(() => { latest.current = final })

  useLayoutEffect(() => {
    const el = ref.current
    const text = el?.firstChild
    const target = Number(value)
    if (!on || !target || !Number.isFinite(target) || text?.nodeType !== Node.TEXT_NODE) return undefined
    const start = latest.current
    const places = (String(value).split('.')[1] ?? '').length
    const inline = getComputedStyle(el).display === 'inline'
    if (inline) el.style.display = 'inline-block'
    el.style.minWidth = `${el.getBoundingClientRect().width}px`

    let anim
    let unview
    const restore = () => {
      anim?.stop()
      unview?.()
      text.nodeValue = latest.current
      el.style.minWidth = ''
      if (inline) el.style.display = ''
    }
    // A new value arriving mid-count (refetch, filter) stops the count and shows the new value.
    const show = (v) => (latest.current === start ? (text.nodeValue = format(places ? Number(v.toFixed(places)) : Math.round(v))) : restore())
    show(0)
    unview = inView(el, () => {
      unview()
      anim = animate(0, target, { duration, ease: EASE_FILL, onUpdate: show, onComplete: restore })
    })
    return restore
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once per mount by design

  return <span ref={ref}>{final}</span>
}
