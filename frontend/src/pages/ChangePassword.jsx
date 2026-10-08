import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, applyFieldErrors } from '../api'
import { useMe } from '../auth'
import { Button, Field, inputClass, PageHeader } from '../components/ui'
import { useToast } from '../components/toast'

const schema = z.object({
  current_password: z.string().min(1, 'Enter your current password'),
  new_password: z.string().min(10, 'At least 10 characters'),
  confirm: z.string(),
}).refine((v) => v.new_password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

export default function ChangePassword() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [error, setFormError] = useState('')
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) })

  const onSubmit = async ({ current_password, new_password }) => {
    setFormError('')
    try {
      const { data } = await api.post('/auth/change-password/', { current_password, new_password })
      qc.setQueryData(['me'], data)
      toast('Password changed.')
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setFormError(applyFieldErrors(err, setError, ['current_password', 'new_password']))
    }
  }

  return (
    <div className="max-w-md">
      <PageHeader title="Change Password">
        {me?.must_change_password && 'Your account requires a new password before you can continue.'}
      </PageHeader>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
        <Field label="Current password" htmlFor="current_password" error={errors.current_password?.message}>
          <input id="current_password" type="password" autoComplete="current-password" className={inputClass} {...register('current_password')} />
        </Field>
        <Field label="New password" htmlFor="new_password" error={errors.new_password?.message}
          hint="At least 10 characters; not too common or similar to your username.">
          <input id="new_password" type="password" autoComplete="new-password" className={inputClass} {...register('new_password')} />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm" error={errors.confirm?.message}>
          <input id="confirm" type="password" autoComplete="new-password" className={inputClass} {...register('confirm')} />
        </Field>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Change password'}</Button>
      </form>
    </div>
  )
}
