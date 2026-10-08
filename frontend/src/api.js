import axios from 'axios'
import { QueryClient, keepPreviousData, useQuery } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => ![401, 403, 404].includes(err?.response?.status) && count < 2,
    },
  },
})

// Django session auth: send cookies, echo csrftoken back as a header.
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  xsrfCookieName: 'csrftoken',
  xsrfHeaderName: 'X-CSRFToken',
})

// 401 = not logged in / session expired. Clearing `me` makes RequireAuth send the user to /login.
api.interceptors.response.use(undefined, (err) => {
  if (err.response?.status === 401 && !err.config.url.startsWith('/auth/')) {
    queryClient.setQueryData(['me'], null)
  }
  return Promise.reject(err)
})

export function errorMessage(err) {
  const data = err?.response?.data
  if (!data) return 'Network error. Please try again.'
  if (typeof data.detail === 'string') return data.detail
  if (typeof data === 'object') return Object.values(data).flat().join(' ') || 'Request failed.'
  return 'Request failed.'
}

// Copies DRF field errors onto react-hook-form fields; returns any message that fits no field.
export function applyFieldErrors(err, setError, fields) {
  const data = err?.response?.data
  if (err?.response?.status !== 400 || !data || typeof data !== 'object') return errorMessage(err)
  const rest = []
  for (const [k, v] of Object.entries(data)) {
    const msg = [v].flat().join(' ')
    if (fields.includes(k)) setError(k, { message: msg })
    else rest.push(msg)
  }
  return rest.join(' ')
}

// Refresh every cached query whose key starts with one of the given API paths (e.g. '/drivers/', '/vehicles/').
export const invalidatePrefix = (qc, ...prefixes) =>
  qc.invalidateQueries({ predicate: (q) => prefixes.some((p) => String(q.queryKey[0]).startsWith(p)) })

// Paginated DRF list: { count, results }. `params` drives the cache key.
export function useList(path, params = {}) {
  return useQuery({
    queryKey: [path, params],
    queryFn: () => api.get(path, { params }).then((r) => r.data),
    placeholderData: keepPreviousData,
  })
}
