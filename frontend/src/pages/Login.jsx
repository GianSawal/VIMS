import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorMessage } from '../api'
import { useMe } from '../auth'

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

const input = 'w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30'

export default function Login() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) })

  if (me) return <Navigate to="/dashboard" replace />

  const onSubmit = async (values) => {
    setError('')
    try {
      await api.get('/auth/csrf/')
      const { data } = await api.post('/auth/login/', values)
      qc.setQueryData(['me'], data)
      navigate(location.state?.from?.pathname || '/dashboard', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-light to-white px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <img src="/dole-logo.png" alt="Department of Labor and Employment logo" className="mx-auto h-28 w-28 object-contain" />
          <h1 className="mt-3 text-xl font-bold text-brand">Vehicle Information Management System</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium">Username</label>
            <input {...register('username')} id="username" autoComplete="username" className={input} />
            {errors.username && <p className="mt-1 text-sm text-danger">{errors.username.message}</p>}
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">Password</label>
            <input {...register('password')} id="password" type="password" autoComplete="current-password" className={input} />
            {errors.password && <p className="mt-1 text-sm text-danger">{errors.password.message}</p>}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
