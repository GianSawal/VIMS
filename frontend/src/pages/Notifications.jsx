import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, CalendarClock, Car, CheckCheck, FileWarning, IdCard, Wrench, X } from 'lucide-react'
import { api, invalidatePrefix, useList } from '../api'
import { Button, PageHeader, formatDateTime } from '../components/ui'

// Notification type -> icon + tint.
const ICON = {
  DOCUMENT_EXPIRY: [FileWarning, 'bg-amber-50 text-amber-700'],
  LTO_RENEWAL: [Car, 'bg-amber-50 text-amber-700'],
  INSURANCE_EXPIRY: [FileWarning, 'bg-amber-50 text-amber-700'],
  LICENSE_EXPIRY: [IdCard, 'bg-amber-50 text-amber-700'],
  MAINTENANCE_DUE: [Wrench, 'bg-brand-light text-brand'],
  MAINTENANCE_OVERDUE: [AlertTriangle, 'bg-red-50 text-danger'],
  ASSIGNMENT: [CalendarClock, 'bg-slate-100 text-slate-700'],
}

export default function Notifications() {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const query = useList('/notifications/', unreadOnly ? { read_at__isnull: true } : {})
  const items = query.data?.results ?? []

  const refresh = () => invalidatePrefix(qc, '/notifications/')
  const read = useMutation({ mutationFn: (id) => api.post(`/notifications/${id}/read/`), onSuccess: refresh })
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all/'), onSuccess: refresh })
  const dismiss = useMutation({ mutationFn: (id) => api.post(`/notifications/${id}/dismiss/`), onSuccess: refresh })

  const open = (n) => {
    if (!n.is_read) read.mutate(n.id)
    if (n.link) navigate(n.link)
  }

  return (
    <div>
      <PageHeader title="Notifications" actions={
        <Button variant="secondary" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
          <CheckCheck size={16} /> Mark all as read
        </Button>
      }>Expiring documents, driver licenses and maintenance that is due or overdue.</PageHeader>

      <div className="mb-3 flex gap-1">
        {[['All', false], ['Unread', true]].map(([label, val]) => (
          <button key={label} onClick={() => setUnreadOnly(val)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${unreadOnly === val ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <Bell className="mx-auto text-slate-300" size={32} />
          <p className="mt-3 text-slate-500">{unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const [Icon, tint] = ICON[n.type] ?? [Bell, 'bg-slate-100 text-slate-700']
            return (
              <li key={n.id}
                className={`flex items-start gap-3 rounded-xl border p-4 shadow-sm ${n.is_read ? 'border-slate-200 bg-white' : 'border-brand-light bg-brand-light/40'}`}>
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tint}`}><Icon size={18} aria-hidden="true" /></span>
                <button type="button" onClick={() => open(n)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                    <span className="font-semibold text-ink">{n.title}</span>
                  </div>
                  <p className="text-sm text-slate-600">{n.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.created_at)}</p>
                </button>
                <button type="button" onClick={() => dismiss.mutate(n.id)} aria-label="Dismiss"
                  className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-danger">
                  <X size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
