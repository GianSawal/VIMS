import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

/**
 * Searchable drop-in for <select>: same props and <option>/<optgroup> children, so `{...register('x')}` and
 * `value`/`onChange(e => e.target.value)` both work. A hidden native <select> keeps the value (forms, defaults,
 * getValues, tests); the visible button opens a list with a search box. The list is a popover (top layer), so
 * modals and overflow-hidden cards don't clip it.
 */
export function Select({ children, className = '', value, defaultValue, onChange, onBlur, name, ref, disabled, id, ...rest }) {
  const native = useRef(null)
  const button = useRef(null)
  const pop = useRef(null)
  const listId = useId()
  const options = optionsOf(children)
  const [current, setCurrent] = useState(value ?? defaultValue ?? '')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [box, setBox] = useState(null)
  const closedAt = useRef(0)

  // Uncontrolled (react-hook-form): the native select holds the value, which defaults/reset/setValue change directly.
  // Checked after every render on purpose (no deps); the inequality stops it from looping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (value === undefined && native.current && native.current.value !== current) setCurrent(native.current.value)
  })
  const selected = value !== undefined && value !== null ? String(value) : current
  const shown = options.find((o) => o.value === selected) ?? options[0]
  const q = query.trim().toLowerCase()
  const matches = q ? options.filter((o) => `${o.label} ${o.group}`.toLowerCase().includes(q)) : options

  const setRefs = (el) => {
    native.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  const show = (initial = '') => {
    if (disabled) return
    const r = button.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    setBox({ left: r.left, width: Math.max(r.width, 224), ...(below < 280 && r.top > below ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) })
    setQuery(initial)
    setActive(Math.max(0, options.findIndex((o) => o.value === selected)))
    setOpen(true)
    pop.current?.showPopover?.()
  }
  const hide = () => {
    pop.current?.hidePopover?.()
    setOpen(false)
  }
  // The list is placed once when it opens, so close it when the page scrolls or resizes under it.
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!pop.current?.contains(e.target)) { pop.current?.hidePopover?.(); setOpen(false) } }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [open])
  const choose = (o) => {
    if (!o || o.disabled) return
    native.current.value = o.value
    setCurrent(o.value)
    hide()
    button.current.focus()
    onChange?.({ target: native.current, currentTarget: native.current, type: 'change' })
    onBlur?.({ target: native.current, type: 'blur' })
  }
  const move = (step) => {
    if (!matches.length) return
    let i = active
    for (let n = 0; n < matches.length; n++) {
      i = (i + step + matches.length) % matches.length
      if (!matches[i].disabled) break
    }
    setActive(i)
    document.getElementById(`${listId}-${i}`)?.scrollIntoView?.({ block: 'nearest' })
  }
  const onListKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(matches[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); button.current.focus() }
    else if (e.key === 'Tab') hide()
  }
  const onButtonKey = (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show() }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); show(e.key) }  // type to search
  }

  return (
    <>
      {/* The button comes first so a wrapping <label> names it, not the hidden select. */}
      <button ref={button} type="button" id={id} disabled={disabled} role="combobox" aria-haspopup="listbox"
        aria-expanded={open} aria-controls={listId} onClick={() => (open ? hide() : Date.now() - closedAt.current > 250 && show())} onKeyDown={onButtonKey}
        className={`flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${className}`} {...rest}>
        <span className={`min-w-0 flex-1 truncate ${shown && !shown.value ? 'text-slate-500' : ''}`}>{shown?.label ?? ' '}</span>
        <ChevronDown size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
      </button>
      {/* Focus sent here (react-hook-form focuses the first invalid field) moves on to the button. */}
      <select ref={setRefs} name={name} value={value ?? undefined} defaultValue={value === undefined ? defaultValue : undefined}
        onChange={(e) => { setCurrent(e.target.value); onChange?.(e) }} onFocus={() => button.current?.focus()} disabled={disabled}
        tabIndex={-1} aria-hidden="true" className="sr-only">
        {children}
      </select>
      <div ref={pop} popover={POPOVER ? 'auto' : undefined} onToggle={(e) => { if (e.newState === 'closed') { closedAt.current = Date.now(); setOpen(false) } }}
        style={box ? { position: 'fixed', margin: 0, inset: 'auto', ...Object.fromEntries(Object.entries(box).map(([k, v]) => [k, `${v}px`])) } : undefined}
        className={`z-50 max-h-72 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-0 text-sm text-ink shadow-xl ${open ? 'flex' : 'hidden'}`}>
        {open && (
          <>
            <label className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <Search size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
              <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setActive(0) }} onKeyDown={onListKey}
                placeholder="Search…" aria-label="Search options" aria-controls={listId}
                aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
                className="w-full bg-transparent py-0.5 placeholder:text-slate-400"
                style={{ outline: 'none' }} />  {/* the global gold :focus-visible ring beats a class; the open list shows focus */}
            </label>
            <ul id={listId} role="listbox" className="overflow-y-auto py-1">
              {matches.length === 0 && <li className="px-3 py-2 text-slate-500">No matches</li>}
              {matches.map((o, i) => (
                <li key={`${o.group}${o.value}`} id={`${listId}-${i}`} role="option" aria-selected={o.value === selected} aria-disabled={o.disabled || undefined}
                  onMouseMove={() => !o.disabled && setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${o.disabled ? 'cursor-not-allowed text-slate-400' : i === active ? 'bg-brand-light text-brand' : ''}`}>
                  <span className="min-w-0 flex-1">
                    {o.group && <span className="mr-1 text-xs text-slate-400">{o.group} ·</span>}{o.label}
                  </span>
                  {o.value === selected && <Check size={16} className="shrink-0 text-brand" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  )
}

// Browsers without the Popover API (and jsdom) get a plain fixed list; it can still be clipped by a transformed parent.
const POPOVER = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'

const textOf = (node) => (node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(textOf).join('') : isValidElement(node) ? textOf(node.props.children) : '')

// <option>s (inside fragments, arrays and <optgroup>s) as [{value, label, disabled, group}].
function optionsOf(children, group = '') {
  const out = []
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return
    if (c.type === 'option') {
      const label = textOf(c.props.children)
      out.push({ value: String(c.props.value ?? label), label, disabled: !!c.props.disabled, group })
    } else if (c.type === 'optgroup') out.push(...optionsOf(c.props.children, c.props.label ?? ''))
    else out.push(...optionsOf(c.props.children, group))  // fragments
  })
  return out
}
