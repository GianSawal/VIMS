import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Pencil } from 'lucide-react'
import { api, applyFieldErrors, errorMessage, invalidatePrefix } from '../../api'
import { useCan } from '../../auth'
import { Button, ConfirmDialog, Field, inputClass, Modal } from '../../components/ui'
import { useToast } from '../../components/toast'

/** Driver logins (role Driver: own trips, record the return). The API returns each temporary password once. */
function useCreateLogins(path, onDone) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post(path).then((r) => r.data),
    onSuccess: (data) => {
      invalidatePrefix(qc, '/drivers/')
      onDone(data.created ?? [data])
    },
  })
}

/** Drivers list: one login for every active driver that has none yet. */
export function CreateLoginsButton() {
  const can = useCan()
  const [confirm, setConfirm] = useState(false)
  const [made, setMade] = useState(null)
  const create = useCreateLogins('/drivers/create-accounts/', (rows) => { setConfirm(false); setMade(rows) })
  if (!can('accounts.add_user')) return null
  return (
    <>
      <Button variant="secondary" onClick={() => { create.reset(); setConfirm(true) }}><KeyRound size={16} /> Create driver logins</Button>
      <ConfirmDialog open={confirm} title="Create driver logins" confirmLabel="Create logins" busy={create.isPending}
        onConfirm={() => create.mutate()} onClose={() => setConfirm(false)}
        message={create.isError ? errorMessage(create.error)
          : 'Every active driver without a login gets one (role Driver: their own trips and recording the return). Each temporary password is shown once, on the next screen.'} />
      <Credentials rows={made} onClose={() => setMade(null)} />
    </>
  )
}

/** Driver profile: the login's username, or a button to create one. */
export function DriverLogin({ driver }) {
  const can = useCan()
  const [made, setMade] = useState(null)
  const create = useCreateLogins(`/drivers/${driver.id}/account/`, setMade)
  const [renaming, setRenaming] = useState(false)
  if (driver.account_username) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="font-mono">{driver.account_username}</span>
        {driver.account_active === false && <span className="text-slate-500">(disabled)</span>}
        {can('accounts.change_user') && (
          <button type="button" onClick={() => setRenaming(true)} className="rounded p-0.5 text-slate-500 hover:bg-white hover:text-brand"
            aria-label="Change username" title="Change username"><Pencil size={14} /></button>
        )}
        <Modal open={renaming} onClose={() => setRenaming(false)} title={`Username for ${driver.full_name}`}>
          {renaming && <RenameForm driver={driver} onClose={() => setRenaming(false)} />}
        </Modal>
      </span>
    )
  }
  if (!can('accounts.add_user') || !driver.is_active) return 'None'
  return (
    <>
      <button type="button" className="font-medium text-brand hover:underline disabled:opacity-60" disabled={create.isPending} onClick={() => create.mutate()}>
        {create.isPending ? 'Creating…' : 'Create login'}
      </button>
      {create.isError && <span role="alert" className="ml-2 text-danger">{errorMessage(create.error)}</span>}
      <Credentials rows={made} onClose={() => setMade(null)} />
    </>
  )
}

function RenameForm({ driver, onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [username, setUsername] = useState(driver.account_username)
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () => api.patch(`/users/${driver.account_id}/`, { username: username.trim() }),
    onSuccess: ({ data }) => {
      invalidatePrefix(qc, '/drivers/', '/users/')
      toast(`Username changed to ${data.username}. Tell ${driver.full_name}; their password stays the same.`)
      onClose()
    },
    onError: (err) => {
      const rest = applyFieldErrors(err, (_, e) => setError(e.message), ['username'])
      if (rest) setError(rest)
    },
  })
  return (
    <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (username.trim()) save.mutate() }}>
      <Field label="Username" htmlFor="driver-username" error={error}
        hint="Letters, digits and @ . + - _ only. The driver signs in with this; the password does not change.">
        <input id="driver-username" autoFocus autoComplete="off" className={`${inputClass} font-mono`} maxLength={150}
          value={username} onChange={(e) => { setUsername(e.target.value); setError('') }} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={save.isPending || !username.trim() || username.trim() === driver.account_username}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

function Credentials({ rows, onClose }) {
  const [copied, setCopied] = useState(false)
  const text = (rows ?? []).map((r) => `${r.full_name}\t${r.username}\t${r.password}`).join('\n')
  const copy = () => navigator.clipboard?.writeText(`Driver\tUsername\tTemporary password\n${text}`).then(() => setCopied(true))
  return (
    <Modal open={!!rows} onClose={() => { setCopied(false); onClose() }} title="Driver logins" wide>
      {rows && (rows.length === 0 ? (
        <p className="text-sm text-slate-600">Every active driver already has a login.</p>
      ) : (
        <div className="space-y-4">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Copy or write these down now: the temporary passwords are not shown again. Each driver sets their own password at first sign-in.
            A lost password is reset from Administration, Users.
          </p>
          <div className="max-h-96 overflow-auto rounded-md border border-slate-200" tabIndex={0} role="region" aria-label="New driver logins">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase"><tr><th className="px-3 py-2">Driver</th><th className="px-3 py-2">Username</th><th className="px-3 py-2">Temporary password</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.driver}>
                    <td className="px-3 py-2">{r.full_name} <span className="text-xs text-slate-500">{r.office_code}</span></td>
                    <td className="px-3 py-2 font-mono">{r.username}</td>
                    <td className="px-3 py-2 font-mono">{r.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={copy}><Copy size={16} /> {copied ? 'Copied' : 'Copy all'}</Button>
            <Button onClick={() => { setCopied(false); onClose() }}>Done</Button>
          </div>
        </div>
      ))}
    </Modal>
  )
}
