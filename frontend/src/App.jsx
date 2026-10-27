import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, RequirePerm } from './auth'
import Layout from './Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Pending from './pages/Pending'
import Notifications from './pages/Notifications'
import Dashboard from './pages/Dashboard'
import Offices from './pages/admin/Offices'
import Users from './pages/admin/Users'
import { Forbidden, NotFound } from './pages/Errors'
import VehicleList from './pages/vehicles/VehicleList'
import VehicleForm from './pages/vehicles/VehicleForm'
import VehicleProfile from './pages/vehicles/VehicleProfile'
import DriverList from './pages/drivers/DriverList'
import DriverProfile from './pages/drivers/DriverProfile'
import TripList from './pages/trips/TripList'
import TripDetail from './pages/trips/TripDetail'
import TripDisplay from './pages/display/TripDisplay'
import FuelList from './pages/fuel/FuelList'
import FuelDetail from './pages/fuel/FuelDetail'
import MaintenanceList from './pages/maintenance/MaintenanceList'
import MaintenanceDetail from './pages/maintenance/MaintenanceDetail'
import DocumentList from './pages/documents/DocumentList'
import DocumentDetail from './pages/documents/DocumentDetail'
import RfidList from './pages/rfid/RfidList'
import RfidDetail from './pages/rfid/RfidDetail'

// Each route gets a real page as its phase is built; Pending marks what's not built yet.
const pending = [
  ['reports', 'Reports', 13],
  ['audit-logs', 'Audit Logs', 14],
]

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/display" element={<TripDisplay />} /> {/* TV board: token link, no staff login */}
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="change-password" element={<ChangePassword />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="notifications" element={<Notifications />} />
          <Route element={<RequirePerm perm="accounts.view_user" />}>
            <Route path="admin/users" element={<Users />} />
          </Route>
          <Route element={<RequirePerm perm="fleet.view_vehicle" />}>
            <Route path="vehicles" element={<VehicleList />} />
            <Route path="vehicles/new" element={<VehicleForm />} />
            <Route path="vehicles/:id" element={<VehicleProfile />} />
            <Route path="vehicles/:id/edit" element={<VehicleForm />} />
          </Route>
          <Route element={<RequirePerm perm="fleet.view_driver" />}>
            <Route path="drivers" element={<DriverList />} />
            <Route path="drivers/:id" element={<DriverProfile />} />
          </Route>
          <Route element={<RequirePerm perm="operations.view_trip" />}>
            <Route path="trips" element={<TripList />} />
            <Route path="trips/:id" element={<TripDetail />} />
          </Route>
          <Route element={<RequirePerm perm="operations.view_fuelrecord" />}>
            <Route path="fuel" element={<FuelList />} />
            <Route path="fuel/:id" element={<FuelDetail />} />
          </Route>
          <Route element={<RequirePerm perm="maintenance.view_maintenancerecord" />}>
            <Route path="maintenance" element={<MaintenanceList />} />
            <Route path="maintenance/:id" element={<MaintenanceDetail />} />
          </Route>
          <Route element={<RequirePerm perm="fleet.view_vehicledocument" />}>
            <Route path="documents" element={<DocumentList />} />
            <Route path="documents/:id" element={<DocumentDetail />} />
          </Route>
          <Route element={<RequirePerm perm="operations.view_rfidaccount" />}>
            <Route path="rfid" element={<RfidList />} />
            <Route path="rfid/accounts/:id" element={<RfidDetail />} />
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
