import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, Monitor } from 'lucide-react'
import { api, errorMessage } from '../../api'
import { Badge, Button, formatDateTime } from '../../components/ui'

const link = (s) => `${window.location.origin}/display?token=${s.token}`

/** Modal body: the TV screens set up in Django admin, with their links. */
export default function TvScreens() {
  const q = useQuery({ queryKey: ['/display-screens/'], queryFn: () => api.get('/display-screens/').then((r) => r.data) })
  const [copied, setCopied] = useState(null)
  const copy = (s) => navigator.clipboard?.writeText(link(s)).then(() => { setCopied(s.id); setTimeout(() => setCopied(null), 2000) })

  if (q.isLoading) return <div className="h-24 animate-pulse rounded-lg bg-slate-200" />
  if (q.isError) return <p className="text-sm text-danger">{errorMessage(q.error)}</p>

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Open a screen on the TV's browser and press <kbd className="rounded border border-slate-300 px-1 text-xs">F11</kbd> for full screen.
        It needs no login and refreshes by itself.
      </p>
      {q.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No TV screens yet. A System Administrator adds one in Django admin under <strong>Operations → Display screens</strong>.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {q.data.map((s) => (
            <li key={s.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${s.is_active ? '' : 'opacity-60'}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand"><Monitor size={20} aria-hidden="true" /></span>
              <div className="mr-auto min-w-0">
                <div className="flex items-center gap-2 font-medium">{s.name} {!s.is_active && <Badge>Turned off</Badge>}</div>
                <div className="text-xs text-slate-500">
                  {s.office_name ?? 'All offices'} · {s.last_seen_at ? `last on ${formatDateTime(s.last_seen_at)}` : 'never opened yet'}
                </div>
              </div>
              {s.is_active && <>
                <Button variant="secondary" onClick={() => copy(s)} aria-label={`Copy link for ${s.name}`}>
                  {copied === s.id ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy link</>}
                </Button>
                <a href={link(s)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark">
                  Open <ExternalLink size={16} aria-hidden="true" />
                </a>
              </>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
