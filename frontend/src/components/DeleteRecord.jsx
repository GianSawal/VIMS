import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { api, errorMessage, invalidatePrefix } from '../api'
import { useCan } from '../auth'
import { useToast } from './toast'
import { Button, ConfirmDialog } from './ui'

/**
 * "Delete" for a record entered by mistake (POST `${path}remove/`, config/removal.py). Shown only with the delete
 * permission (System Administrator). The API refuses records with history; its message says to archive instead.
 */
export default function DeleteRecord({ path, perm, name, kind, listPath }) {
  const can = useCan()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const remove = useMutation({
    mutationFn: () => api.post(`${path}remove/`),
    onSuccess: () => {
      setOpen(false)
      navigate(listPath, { replace: true })
      invalidatePrefix(qc, `/${path.split('/')[1]}/`, '/dashboard/')  // '/vehicles/5/' -> every '/vehicles/' query
      toast(`${name} deleted.`)
    },
    onError: (err) => { setOpen(false); toast(errorMessage(err), 'error') },
  })
  if (!can(perm)) return null
  return (
    <>
      <Button variant="ghost" className="text-danger hover:bg-red-50" onClick={() => setOpen(true)}><Trash2 size={16} /> Delete</Button>
      <ConfirmDialog open={open} title={`Delete ${kind}`} danger busy={remove.isPending} confirmLabel="Delete permanently"
        message={`Permanently delete ${name}? Only for a ${kind} entered by mistake: it works only while nothing is recorded for it yet (trips, fuel, maintenance, tolls...). This cannot be undone.`}
        onConfirm={() => remove.mutate()} onClose={() => setOpen(false)} />
    </>
  )
}
