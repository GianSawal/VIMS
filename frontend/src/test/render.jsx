import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Logged-in user as /api/auth/me/ returns it. Queries never hit the network: data is seeded and never stale.
export function meWith(permissions = [], extra = {}) {
  return { username: 'tester', first_name: 'Test', role: 'Viewer', is_superuser: false, must_change_password: false,
           permissions, offices: [], ...extra }
}

export function renderApp(ui, { me = meWith(), path = '/', routes, data = {} } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: () => new Promise(() => {}) } } })
  qc.setQueryData(['me'], me)
  for (const [key, value] of Object.entries(data)) qc.setQueryData(JSON.parse(key), value)
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        {routes ? <Routes>{routes}</Routes> : <Routes><Route path="*" element={ui} /></Routes>}
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
