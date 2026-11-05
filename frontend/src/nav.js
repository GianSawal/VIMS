import {
  Bell, Building2, Car, ClipboardList, ClipboardPen, CreditCard, FileSpreadsheet, FileText, Fuel, IdCard, LayoutDashboard,
  Route as RouteIcon, ScrollText, Trash2, Users, Wrench,
} from 'lucide-react'
import { seesDashboard } from './auth'

// [path, label, icon, permission needed to see it (null = everyone, or a rule taking `can`)]
export const nav = [
  ['/dashboard', 'Dashboard', LayoutDashboard, (can) => seesDashboard(can)],  // looked up at call time: ui.jsx -> nav.js -> auth.jsx can load in a cycle
  ['/requests', 'Vehicle requests', ClipboardPen, 'operations.view_vehiclerequest'],
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
  ['/admin/import', 'Data Import', FileSpreadsheet, 'accounts.import_data'],
  ['/admin/purge', 'Delete test data', Trash2, 'accounts.purge_test_data'],
]

// The menu entry a path belongs to (longest matching prefix), e.g. '/vehicles/12' -> Vehicles. PageHeader shows its icon.
export const navFor = (pathname) => nav.filter(([to]) => pathname === to || pathname.startsWith(`${to}/`))
  .sort((a, b) => b[0].length - a[0].length)[0]
