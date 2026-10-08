import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Bell, Building2, Car, ClipboardList, FileText, Fuel, IdCard, KeyRound, LayoutDashboard, LogOut, Menu,
  Route as RouteIcon, ScrollText, Users, Wrench, X,
} from 'lucide-react'
import { useCan, useLogout, useMe } from './auth'

// [path, label, icon, permission needed to see it (null = everyone)]
const nav = [
  ['/dashboard', 'Dashboard', LayoutDashboard, null],
  ['/vehicles', 'Vehicles', Car, 'fleet.view_vehicle'],
  ['/drivers', 'Drivers', IdCard, 'fleet.view_driver'],
  ['/trips', 'Trips', RouteIcon, 'operations.view_trip'],
  ['/fuel', 'Fuel', Fuel, 'operations.view_fuelrecord'],
  ['/maintenance', 'Maintenance', Wrench, 'maintenance.view_maintenancerecord'],
  ['/documents', 'Documents', FileText, 'fleet.view_vehicledocument'],
  ['/reports', 'Reports', ClipboardList, 'fleet.view_vehicle'],
  ['/notifications', 'Notifications', Bell, null],
  ['/admin/users', 'Users', Users, 'accounts.view_user'],
  ['/admin/offices', 'Offices', Building2, 'accounts.view_office'],
  ['/audit-logs', 'Audit Logs', ScrollText, 'audit.view_auditlog'],
]

export default function Layout() {
  const { data: me } = useMe()
  const can = useCan()
  const logout = useLogout()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const onLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-72 transform overflow-y-auto border-r border-slate-200 bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-5">
          <img src="/dole-logo.png" alt="DOLE logo" className="h-14 w-14 object-contain" />
          <div className="leading-tight">
            <div className="text-lg font-bold text-brand">DOLE VIMS</div>
            <div className="text-[13px] text-slate-500">Vehicle Information Management</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        <nav className="space-y-1.5 p-4" aria-label="Main">
          {nav.filter(([, , , perm]) => !perm || can(perm)).map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3.5 rounded-lg border-l-4 px-4 py-3 text-base font-medium ${
                  isActive
                    ? 'border-accent bg-brand-light text-brand'
                    : 'border-transparent text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <Icon size={22} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {open && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-right leading-tight">
              <span className="block font-medium">{me?.first_name || me?.username}</span>
              <span className="block text-xs text-slate-500">{me?.role ?? 'No role assigned'}</span>
            </span>
            <NavLink to="/change-password" className="flex items-center gap-1 text-slate-600 hover:text-brand">
              <KeyRound size={16} aria-hidden="true" /> <span className="hidden sm:inline">Password</span>
            </NavLink>
            <button onClick={onLogout} className="flex items-center gap-1 text-slate-600 hover:text-danger">
              <LogOut size={16} aria-hidden="true" /> Logout
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
