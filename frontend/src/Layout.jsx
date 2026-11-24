import { Fragment, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Bell, Building2, KeyRound, LogOut, Menu, UserRound, X } from 'lucide-react'
import { api } from './api'
import { drivesOnly, useCan, useLogout, useMe } from './auth'
import { Avatar } from './components/filters'
import { nav, navFor } from './nav'
import { useUnreadCount } from './notifications'
import { EASE_OUT } from './components/motion'

// Route change: the old page fades out quickly, then the new one fades in and rises 10px.
const PAGE_OUT = { duration: 0.18, ease: 'easeOut' }
const PAGE_IN = { opacity: { duration: 0.22, ease: 'easeOut' }, y: { duration: 0.26, ease: EASE_OUT } }

export default function Layout() {
  const { data: me } = useMe()
  const can = useCan()
  const logout = useLogout()
  const { data: unread = 0 } = useUnreadCount()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const outlet = useOutlet()

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
          {nav.filter(([, , , perm]) => !perm || (typeof perm === 'function' ? perm(can) : can(perm))).map(([to, label, Icon, , group], i, shown) => (
            <Fragment key={to}>
            {group && group !== shown[i - 1]?.[4] && (
              <div className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{group}</div>
            )}
            <NavLink
              key={to}
              to={to}
              end={to === '/my-trips'} // Today is not also "active" on Trip history (/my-trips/history)
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
            </Fragment>
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
          <motion.div className="fixed inset-0 z-25 bg-black/30 lg:hidden" onClick={() => setOpen(false)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader me={me} unread={unread} onMenu={() => setOpen(true)} onLogout={onLogout} />
        <main className="flex-1 p-4 lg:p-6">
          {/* Keyed on the path (not the query string), so filters, sorting, paging and ?tab= never replay it.
              useOutlet() hands AnimatePresence a fixed element, so the old page stays on screen while it fades out;
              the new page then rises in, and the window scrolls to the top only after a real page change. */}
          <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo(0, 0)}>
            <motion.div key={pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: PAGE_IN }}
              exit={{ opacity: 0, y: -6, transition: PAGE_OUT }}>
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

/** Phone/tablet top bar (hidden on desktop, where the sidebar shows all of this). Left: menu, or back on a detail page
 *  (a trip, vehicle, report...). Middle: logo and the page name. Right: office chip for multi-office users, the
 *  notification bell with the unread count, and the account menu. */
function MobileHeader({ me, unread, onMenu, onLogout }) {
  const can = useCan()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const menu = useRef(null)
  const entry = navFor(pathname)
  const detail = entry && pathname !== entry[0] // e.g. /trips/12 under Trips
  const title = entry?.[1] ?? 'DOLE VRS'
  const driver = drivesOnly(can)
  // Same query as the driver pages (already cached there): the driver's photo for the avatar.
  const home = useQuery({ queryKey: ['/driver/home/'], queryFn: () => api.get('/driver/home/').then((r) => r.data), enabled: driver })
  const name = [me?.first_name, me?.last_name].filter(Boolean).join(' ') || me?.username
  const offices = me?.offices ?? []
  const officeChip = me?.view_all_offices ? 'All offices' : offices.length > 1 ? `${offices.length} offices` : null
  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate(entry[0]))
  const close = () => menu.current?.hidePopover()

  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
      {detail ? (
        <button onClick={back} aria-label={`Back to ${entry[1]}`} className="rounded-lg p-2 hover:bg-slate-100"><ArrowLeft size={22} /></button>
      ) : (
        <button onClick={onMenu} aria-label="Open menu" className="rounded-lg p-2 hover:bg-slate-100"><Menu size={22} /></button>
      )}
      <Link to="/" className="flex min-w-0 flex-1 items-center gap-2">
        <img src="/dole-logo.png" alt="DOLE VRS home" className="h-8 w-8 shrink-0 object-contain" />
        <span className="truncate font-semibold text-ink">{title}</span>
      </Link>
      {officeChip && (
        <span title={offices.map((o) => o.name).join(', ') || 'Every office'}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 max-[380px]:hidden">
          <Building2 size={12} aria-hidden="true" /> {officeChip}
        </span>
      )}
      <Link to="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative rounded-lg p-2 hover:bg-slate-100">
        <Bell size={22} aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute top-0.5 right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
      <button popoverTarget="account-menu" aria-label="Account menu" className="rounded-full p-0.5 hover:ring-2 hover:ring-brand-light">
        <Avatar name={name} src={home.data?.driver?.photo_url} className="h-9! w-9! text-xs" />
      </button>
      {/* Native popover: Esc and tapping outside close it, no extra code. Pinned under the bar on the right. */}
      <div id="account-menu" ref={menu} popover="auto"
        className="fixed inset-auto top-14 right-3 m-0 w-64 rounded-xl border border-slate-200 bg-white p-2 text-ink shadow-lg">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar name={name} src={home.data?.driver?.photo_url} />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-semibold">{name}</div>
            <div className="truncate text-xs text-slate-500">{me?.role ?? 'No role assigned'}</div>
            {offices.length > 0 && <div className="truncate text-xs text-slate-500">{offices.map((o) => o.code).join(', ')}</div>}
          </div>
        </div>
        <div className="my-1 border-t border-slate-100" />
        {driver && (
          <Link to="/my-profile" onClick={close} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium hover:bg-slate-100">
            <UserRound size={18} aria-hidden="true" /> My profile
          </Link>
        )}
        <Link to="/change-password" onClick={close} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium hover:bg-slate-100">
          <KeyRound size={18} aria-hidden="true" /> Change password
        </Link>
        <button onClick={() => { close(); onLogout() }} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium hover:bg-slate-100 hover:text-danger">
          <LogOut size={18} aria-hidden="true" /> Log out
        </button>
      </div>
    </header>
  )
}
