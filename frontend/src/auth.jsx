import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { api } from './api'
import { Forbidden } from './pages/Errors'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me/').then((r) => r.data).catch((e) => {
      if (e.response?.status === 401) return null
      throw e
    }),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

// can('accounts.view_user'). UI hint only; the API enforces the same permissions.
export function useCan() {
  const { data: me } = useMe()
  return (perm) => !!me && (me.is_superuser || me.permissions.includes(perm))
}

export function useLogout() {
  const qc = useQueryClient()
  return async () => {
    await api.post('/auth/logout/').catch(() => {})
    qc.clear()
    qc.setQueryData(['me'], null)
  }
}

export function RequireAuth() {
  const { data: me, isLoading, isError } = useMe()
  const location = useLocation()
  if (isLoading) return <div className="p-8 text-slate-500">Loading…</div>
  if (isError) return <div className="p-8 text-danger">Cannot reach the server. Please try again later.</div>
  if (!me) return <Navigate to="/login" replace state={{ from: location }} />
  if (me.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <Outlet />
}

export function RequirePerm({ perm }) {
  const can = useCan()
  return can(perm) ? <Outlet /> : <Forbidden />
}
