import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequirePerm } from './auth'
import Layout from './Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Pending from './pages/Pending'
import Offices from './pages/admin/Offices'
import Users from './pages/admin/Users'
import { Forbidden, NotFound } from './pages/Errors'

// Each route gets a real page as its phase is built; Pending marks what's not built yet.
const pending = [
  ['dashboard', 'Dashboard', 12],
  ['vehicles', 'Vehicles', 4],
  ['vehicles/new', 'Add Vehicle', 4],
  ['vehicles/:id', 'Vehicle Profile', 4],
  ['vehicles/:id/edit', 'Edit Vehicle', 4],
  ['drivers', 'Drivers', 5],
  ['trips', 'Trips', 6],
  ['fuel', 'Fuel', 7],
  ['maintenance', 'Maintenance', 8],
  ['documents', 'Documents & Renewals', 9],
  ['reports', 'Reports', 13],
  ['notifications', 'Notifications', 11],
  ['audit-logs', 'Audit Logs', 14],
]

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="change-password" element={<ChangePassword />} />
          <Route element={<RequirePerm perm="accounts.view_user" />}>
            <Route path="admin/users" element={<Users />} />
          </Route>
          <Route element={<RequirePerm perm="accounts.view_office" />}>
            <Route path="admin/offices" element={<Offices />} />
          </Route>
          {pending.map(([path, title, phase]) => (
            <Route key={path} path={path} element={<Pending title={title} phase={phase} />} />
          ))}
          <Route path="forbidden" element={<Forbidden />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}
