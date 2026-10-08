import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const variants = {
  primary: 'bg-brand text-white hover:bg-brand-dark',
  secondary: 'border border-slate-300 bg-white text-ink hover:bg-slate-50',
  danger: 'bg-danger text-white hover:bg-red-800',
  ghost: 'text-brand hover:bg-brand-light',
}

export function Button({ variant = 'primary', className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none'

export function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  )
}

const tones = {
  green: 'bg-green-100 text-green-800',
  gray: 'bg-slate-100 text-slate-700',
  blue: 'bg-brand-light text-brand',
  red: 'bg-red-100 text-danger',
  gold: 'bg-amber-100 text-amber-900',
}

export function Badge({ tone = 'gray', dot = false, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}

export function PageHeader({ title, actions, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="mr-auto">
        <h1 className="text-2xl font-bold text-brand">{title}</h1>
        {children && <p className="text-sm text-slate-500">{children}</p>}
      </div>
      {actions}
    </div>
  )
}

// Native <dialog>: focus trap, Esc to close and backdrop come from the browser.
export function Modal({ open, onClose, title, children, wide = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto w-[calc(100%-2rem)] rounded-xl p-0 shadow-xl backdrop:bg-black/40 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
    >
      {open && (
        <div>
          <div className="flex items-center border-b border-slate-200 px-5 py-3">
            <h2 className="font-semibold text-brand">{title}</h2>
            <button className="ml-auto text-slate-500 hover:text-ink" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      )}
    </dialog>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-slate-600">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}

export const formatDateTime = (v) =>
  v ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '—'
