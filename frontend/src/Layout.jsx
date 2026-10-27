import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bell, Building2, Car, ClipboardList, CreditCard, FileText, Fuel, IdCard, KeyRound, LayoutDashboard, LogOut, Menu,
  Route as RouteIcon, ScrollText, Users, Wrench, X,
} from 'lucide-react'
import { useCan, useLogout, useMe } from './auth'
import { useUnreadCount } from './notifications'

// [path, label, icon, permission needed to see it (null = everyone)]
const nav = [
  ['/dashboard', 'Dashboard', LayoutDashboard, null],
  ['/vehicles', 'Vehicles', Car, 'fleet.view_vehicle'],
  ['/drivers', 'Drivers', IdCard, 'fleet.view_driver'],
  ['/trips', 'Trips', RouteIcon, 'operations.view_trip'],
  ['/fuel', 'Fuel', Fuel, 'operations.view_fuelrecord'],
  ['/maintenance', 'Maintenance', Wrench, 'maintenance.view_maintenancerecord'],
  ['/documents', 'Documents', FileText, 'fleet.view_vehicledocument'],
  ['/rfid', 'RFID / Toll', CreditCard, 'operations.view_rfidaccount'],
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
  const { data: unread = 0 } = useUnreadCount()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  const onLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-60 transform flex-col overflow-y-auto border-r border-slate-200 bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
          <img src="/dole-logo.png" alt="DOLE logo" className="h-12 w-12 object-contain" />
          <div className="leading-tight">
            <div className="text-base font-bold text-brand">DOLE VRS</div>
            <div className="text-xs text-slate-500">Vehicle Records System</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-3" aria-label="Main">
          {nav.filter(([, , , perm]) => !perm || can(perm)).map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg border-l-4 px-3 py-2.5 text-[15px] font-medium ${
                  isActive
                    ? 'border-accent bg-brand-light text-brand'
                    : 'border-transparent text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <Icon size={20} aria-hidden="true" />
              {label}
              {to === '/notifications' && unread > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-slate-200 p-3">
          <div className="px-3 py-2 leading-tight">
            <div className="font-medium">{me?.first_name || me?.username}</div>
            <div className="text-xs text-slate-500">{me?.role ?? 'No role assigned'}</div>
          </div>
          <NavLink to="/change-password" onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium text-slate-600 hover:bg-slate-100">
            <KeyRound size={20} aria-hidden="true" /> Password
          </NavLink>
          <button onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] font-medium text-slate-600 hover:bg-slate-100 hover:text-danger">
            <LogOut size={20} aria-hidden="true" /> Logout
          </button>
        </div>
      </aside>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
        </header>
        <main className="flex-1 p-4 lg:p-6">
          {/* keyed on the path (not the query string) so filter changes don't replay the page entrance.
              ponytail: enter only; an exit (AnimatePresence mode="wait") would delay every navigation */}
          <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }}>
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  )
}
