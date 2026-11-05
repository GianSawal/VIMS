import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api, errorMessage } from '../../api'
import { Button, PageHeader, inputBase } from '../../components/ui'
import { useToast } from '../../components/toast'

// System Administrator only (accounts.purge_test_data, enforced by the API). Vehicles and drivers are never deleted.
export default function PurgeData() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['/admin/purge/'], queryFn: () => api.get('/admin/purge/').then((r) => r.data) })
  const [picked, setPicked] = useState(() => new Set())
  const [confirm, setConfirm] = useState('')
  const purge = useMutation({
    mutationFn: () => api.post('/admin/purge/', { groups: [...picked], confirm }),
    onSuccess: () => {
      qc.invalidateQueries()  // every list, dashboard and count may have changed
      setPicked(new Set())
      setConfirm('')
      toast('Test data deleted.')
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  })
  const toggle = (key) => setPicked((s) => {
    const next = new Set(s)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <div>
      <PageHeader title="Delete test data">Clear records entered while testing, before the system goes live.</PageHeader>
      <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-danger">
          This permanently deletes the chosen records and cannot be undone. Vehicles, drivers, offices and users are kept.
          The audit log keeps its history and records this deletion. Take a backup first.
        </p>
        <fieldset disabled={purge.isPending} className="space-y-1">
          <legend className="mb-2 text-sm font-medium">What to delete</legend>
          {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {q.data?.map((g) => (
            <label key={g.key} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={picked.has(g.key)} onChange={() => toggle(g.key)} className="h-4 w-4 accent-danger" />
              <span className="mr-auto">{g.label}</span>
              <span className="text-xs text-slate-500 tabular-nums">{g.count} {g.key === 'odometers' ? 'vehicles' : 'records'}</span>
            </label>
          ))}
        </fieldset>
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <label className="mr-auto text-sm">
            <span className="mb-1 block font-medium">Type DELETE to confirm</span>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${inputBase} w-44`} autoComplete="off" />
          </label>
          <Button variant="danger" disabled={!picked.size || confirm !== 'DELETE' || purge.isPending} onClick={() => purge.mutate()}>
            <Trash2 size={16} aria-hidden="true" /> {purge.isPending ? 'Deleting…' : 'Delete selected'}
          </Button>
        </div>
      </section>
    </div>
  )
}
