import { describe, expect, it } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthGuard, AuthUser } from './auth.guard';

const user = { sub: 'u1', name: 'Test', email: 't@x', role: 'tester' as const };

function makeCtx(headers: Record<string, string>, req: any = {}) {
  Object.assign(req, { headers });
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
    req,
  } as any;
}

function makeGuard(opts: {
  isPublic?: boolean;
  roles?: string[];
  valid?: boolean;
  dbUser?: { id: string; name: string; email: string; role: string; active: boolean } | null;
  /** Permissions the caller holds, for the step-2 comparison. */
  held?: string[];
  /** Permissions the route will require once enforcement switches. */
  required?: string[];
  /** Collects mismatch reports so a test can assert on them. */
  reports?: any[];
}) {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === 'isPublic') return opts.isPublic ?? false;
      if (key === 'permissions') return opts.required;
      if (key === 'permissionChange') return undefined;
      return opts.roles;
    },
  } as any;
  const jwt = {
    verifyAsync: async () => {
      if (opts.valid === false) throw new Error('bad token');
      return user;
    },
  } as any;
  const dbUser =
    opts.dbUser === undefined
      ? { id: user.sub, name: user.name, email: user.email, role: user.role, active: true }
      : opts.dbUser;
  const db = { users: () => ({ findOne: async () => dbUser }) } as any;
  const perms = {
    forUser: async () => new Set(opts.held ?? []),
    report: (r: any) => opts.reports?.push(r),
  } as any;
  return new AuthGuard(jwt, reflector, db, perms);
}

const g0 = (guard: AuthGuard) =>
  guard.canActivate(makeCtx({ authorization: 'Bearer x' }));

describe('AuthGuard', () => {
  it('lets @Public routes through with no token', async () => {
    const g = makeGuard({ isPublic: true });
    await expect(g.canActivate(makeCtx({}))).resolves.toBe(true);
  });

  it('rejects a missing token', async () => {
    const g = makeGuard({});
    await expect(g.canActivate(makeCtx({}))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid token', async () => {
    const g = makeGuard({ valid: false });
    await expect(g.canActivate(makeCtx({ authorization: 'Bearer x' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches the caller with their resolved permissions', async () => {
    const g = makeGuard({ held: ['devices.view'] });
    const ctx = makeCtx({ authorization: 'Bearer x' });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.req.user).toEqual({ ...user, permissions: new Set(['devices.view']) });
  });

  it('attaches freshly resolved permissions, never ones from the token', async () => {
    // The claim carries no permissions at all, so there is nothing stale to
    // trust: revoking one takes effect on the next request, not at expiry.
    const g = makeGuard({ held: ['devices.view', 'devices.create'] });
    const ctx = makeCtx({ authorization: 'Bearer x' });
    await g.canActivate(ctx);
    expect(ctx.req.user.permissions).toEqual(new Set(['devices.view', 'devices.create']));
  });

  it('rejects a token whose user was deactivated', async () => {
    const g = makeGuard({
      dbUser: { id: 'u1', name: 'Test', email: 't@x', role: 'tester', active: false },
    });
    await expect(g.canActivate(makeCtx({ authorization: 'Bearer x' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose user was deleted', async () => {
    const g = makeGuard({ dbUser: null });
    await expect(g.canActivate(makeCtx({ authorization: 'Bearer x' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('uses the CURRENT role from the DB, not the token claim', async () => {
    // token says tester; DB says the user was promoted to manager
    const g = makeGuard({
      roles: ['manager'],
      dbUser: { id: 'u1', name: 'Test', email: 't@x', role: 'manager', active: true },
    });
    const ctx = makeCtx({ authorization: 'Bearer x' });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.req.user.role).toBe('manager');
  });
});
