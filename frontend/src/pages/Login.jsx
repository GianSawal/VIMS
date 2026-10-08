import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Bell, Car, Eye, EyeOff, Loader2, Lock, Route as RouteIcon, User } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useMe } from '../auth'

const schema = z.object({
  username: z.string().trim().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
})

const FEATURES = [
  [Car, 'Vehicle records', 'Every vehicle, its assignment and complete history in one place.'],
  [RouteIcon, 'Trips, fuel and maintenance', 'Trip tickets, odometer readings and service records.'],
  [Bell, 'Renewals and alerts', 'LTO, insurance and license expirations before they lapse.'],
]

const YEAR = new Date().getFullYear()

const field = 'w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-3 pl-10 text-[15px] focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none aria-[invalid=true]:border-danger'

export default function Login() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
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
      setError(err.response?.status === 429
        ? 'Too many sign-in attempts. Please wait a minute and try again.'
        : errorMessage(err))
    }
  }

  const checkCaps = (e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden w-[46%] max-w-2xl overflow-hidden bg-gradient-to-br from-brand to-brand-dark px-12 py-10 text-white lg:flex lg:flex-col">
        {/* Shapes echo the logo's triangle and red/gold accents; purely decorative. */}
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rotate-12 bg-white/5 [clip-path:polygon(50%_0,100%_100%,0_100%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute top-10 -right-10 h-40 w-40 -rotate-12 bg-accent/30 [clip-path:polygon(50%_0,100%_100%,0_100%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-40 left-[-3rem] h-24 w-24 rounded-full bg-gold/20" />

        <div className="relative flex items-center gap-3">
          {/* Emblem cropped from the official logo (IMAGES/DOLE.png); the full logo with wordmark is used on light backgrounds. */}
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-md">
            <img src="/dole-emblem.png" alt="DOLE emblem" className="h-9 w-9 object-contain" />
          </span>
          <div className="leading-tight">
            <div className="text-lg font-bold">DOLE VRS</div>
            <div className="text-sm text-white/75">Department of Labor and Employment</div>
          </div>
        </div>

        <div className="relative mt-auto mb-auto pt-12">
          <h2 className="text-4xl leading-tight font-bold">Vehicle Records<br />System</h2>
          <p className="mt-4 max-w-md text-lg text-white/80">
            Centralized records for DOLE regional and field office vehicles.
          </p>
          <ul className="mt-10 space-y-5">
            {FEATURES.map(([Icon, title, text]) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-white/75">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">© {YEAR} Department of Labor and Employment</p>
      </aside>

      {/* Sign-in */}
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <img src="/dole-logo.png" alt="Department of Labor and Employment logo" className="mx-auto h-24 w-24 object-contain" />
            <div className="mt-3 text-xl font-bold text-brand">DOLE VRS</div>
            <div className="text-sm text-slate-500">Vehicle Records System</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
            <h1 className="text-2xl font-bold text-ink">Sign in</h1>
            <p className="mt-1 text-sm text-slate-500">Use the account given to you by your System Administrator.</p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-danger">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label htmlFor="username" className="mb-1.5 block text-sm font-medium">Username</label>
                <div className="relative">
                  <User size={18} className="absolute top-3 left-3 text-slate-400" aria-hidden="true" />
                  <input {...register('username')} id="username" autoComplete="username" autoFocus className={field}
                    aria-invalid={!!errors.username} aria-describedby={errors.username ? 'username-error' : undefined} />
                </div>
                {errors.username && <p id="username-error" className="mt-1.5 text-sm text-danger">{errors.username.message}</p>}
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium">Password</label>
                <div className="relative">
                  <Lock size={18} className="absolute top-3 left-3 text-slate-400" aria-hidden="true" />
                  <input {...register('password')} id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                    className={`${field} pr-11`} onKeyUp={checkCaps} onKeyDown={checkCaps}
                    aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : capsLock ? 'caps-warning' : undefined} />
                  <button type="button" onClick={() => setShowPassword((s) => !s)}
                    className="absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-ink"
                    aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && <p id="password-error" className="mt-1.5 text-sm text-danger">{errors.password.message}</p>}
                {capsLock && !errors.password && <p id="caps-warning" className="mt-1.5 text-sm text-amber-700">Caps Lock is on.</p>}
              </div>

              <button type="submit" disabled={isSubmitting}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-70">
                {isSubmitting && <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="mt-6 border-t border-slate-100 pt-5 text-center text-sm text-slate-500">
              Forgot your password? Ask your System Administrator to reset it.
            </p>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            For authorized DOLE personnel only. Sign-ins are recorded.
          </p>
        </div>
      </main>
    </div>
  )
}
