import { describe, expect, it } from 'vitest'
import { nav } from './nav'

const visible = (perms) => {
  const can = (p) => perms.includes(p)
  return nav.filter(([, , , rule]) => rule == null || (typeof rule === 'function' ? rule(can) : can(rule))).map(([, label]) => label)
}

describe('menu', () => {
  it('gives a driver account only their trips and notifications (no dashboard, no vehicle requests)', () => {
    expect(visible(['operations.drive_trip', 'notifications.view_notification'])).toEqual(['My trips', 'Notifications'])
  })
  it('keeps the requester menu', () => {
    expect(visible(['operations.view_vehiclerequest', 'operations.add_vehiclerequest'])).toEqual(['Vehicle requests', 'Vehicle schedule', 'Notifications'])
  })
})
