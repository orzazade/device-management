import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AuditController } from '../audit/audit.controller';
import { AuthController } from '../auth/auth.controller';
import { DevicesController } from '../devices/devices.controller';
import { HealthController } from '../health/health.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { ProjectsController } from '../projects/projects.controller';
import { RepairsController } from '../repairs/repairs.controller';
import { ReportsController } from '../reports/reports.controller';
import { RequestsController } from '../requests/requests.controller';
import { UsersController } from '../users/users.controller';
import { ALL_PERMISSION_KEYS } from './permissions';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './auth.guard';

/**
 * Deny by default, enforced at build time.
 *
 * A route with no permission is reachable by anyone signed in. That is
 * sometimes right and sometimes an oversight, and the two look identical in
 * a diff — so every route must either carry @RequirePermission or appear in
 * the exemption list below with a reason. Adding an endpoint without doing
 * one of the two fails this test.
 */

const CONTROLLERS = [
  ['AuditController', AuditController],
  ['AuthController', AuthController],
  ['DevicesController', DevicesController],
  ['HealthController', HealthController],
  ['NotificationsController', NotificationsController],
  ['ProjectsController', ProjectsController],
  ['RepairsController', RepairsController],
  ['ReportsController', ReportsController],
  ['RequestsController', RequestsController],
  ['UsersController', UsersController],
] as const;

/**
 * Routes that deliberately carry no permission, and why.
 *
 * Two kinds only:
 *
 *   SELF — the handler scopes everything to the caller, so there is nothing
 *          a permission would add. Reading your own notifications is not a
 *          capability anyone needs granting.
 *
 *   RELATIONSHIP — any signed-in person may legitimately call it, and whether
 *          THIS record is theirs to act on is decided inside the handler
 *          against the device's holder or the request's requester. A
 *          permission here would break peer approval, which is the core of
 *          how the lab works.
 */
const EXEMPT: Record<string, string> = {
  'AuthController.login': 'public — issues the token',
  'AuthController.me': 'SELF — returns the caller',
  'AuthController.changePassword': 'SELF — changes the caller’s own password',
  'HealthController.health': 'public — liveness probe',

  'NotificationsController.list': 'SELF — the caller’s own feed',
  'NotificationsController.readOne': 'SELF — scoped to the caller’s rows',
  'NotificationsController.readAll': 'SELF — scoped to the caller’s rows',

  'RequestsController.pendingMyApproval': 'SELF — what the caller must decide',
  'RequestsController.approve': 'RELATIONSHIP — the device’s holder decides',
  'RequestsController.reject': 'RELATIONSHIP — the device’s holder decides',
  'RequestsController.overrideTime': 'RELATIONSHIP — a holder may extend their own loan',
  'RequestsController.returnDevice': 'RELATIONSHIP — holder or desk, checked in the handler',
  'RequestsController.returnIntent': 'RELATIONSHIP — only the holder may offer a return',
  'RequestsController.cancel': 'RELATIONSHIP — requester, holder or staff',
};

function routesOf(cls: any): { name: string; permissions?: string[]; isPublic: boolean }[] {
  const out: { name: string; permissions?: string[]; isPublic: boolean }[] = [];
  for (const name of Object.getOwnPropertyNames(cls.prototype)) {
    if (name === 'constructor') continue;
    const fn = cls.prototype[name];
    if (typeof fn !== 'function') continue;
    // Nest stores the route path on the handler; anything without one is a
    // private helper, not an endpoint.
    if (Reflect.getMetadata('path', fn) === undefined) continue;
    out.push({
      name,
      permissions: Reflect.getMetadata(PERMISSIONS_KEY, fn),
      isPublic:
        Reflect.getMetadata(PUBLIC_KEY, fn) === true ||
        Reflect.getMetadata(PUBLIC_KEY, cls) === true,
    });
  }
  return out;
}

describe('every route is accounted for', () => {
  it('carries a permission or is a documented exemption', () => {
    const unaccounted: string[] = [];
    for (const [label, cls] of CONTROLLERS) {
      for (const route of routesOf(cls)) {
        const id = `${label}.${route.name}`;
        if (route.permissions?.length) continue;
        if (EXEMPT[id]) continue;
        if (route.isPublic && EXEMPT[id]) continue;
        unaccounted.push(id);
      }
    }
    expect(
      unaccounted,
      `add @RequirePermission, or list them in EXEMPT with a reason:\n  ${unaccounted.join('\n  ')}`,
    ).toEqual([]);
  });

  it('only requires permissions that exist in the catalogue', () => {
    for (const [label, cls] of CONTROLLERS) {
      for (const route of routesOf(cls)) {
        for (const key of route.permissions ?? []) {
          expect(ALL_PERMISSION_KEYS, `${label}.${route.name} requires unknown ${key}`).toContain(
            key,
          );
        }
      }
    }
  });

  it('has no stale exemptions', () => {
    // An exemption that no longer matches a route is a comment pretending to
    // be a rule — it would quietly stop covering anything.
    const real = new Set<string>();
    for (const [label, cls] of CONTROLLERS) {
      for (const route of routesOf(cls)) real.add(`${label}.${route.name}`);
    }
    for (const id of Object.keys(EXEMPT)) {
      expect(real, `EXEMPT lists ${id}, which is not a route`).toContain(id);
    }
  });

  it('never exempts a route that also declares a permission', () => {
    // Both would mean the exemption's reason is wrong, and the reader cannot
    // tell which of the two is the intent.
    for (const [label, cls] of CONTROLLERS) {
      for (const route of routesOf(cls)) {
        const id = `${label}.${route.name}`;
        if (route.permissions?.length) {
          expect(EXEMPT[id], `${id} is both exempt and permissioned`).toBeUndefined();
        }
      }
    }
  });
});
