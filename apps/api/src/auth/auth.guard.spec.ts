import { describe, expect, it } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthGuard, AuthUser } from './auth.guard';

const user = { sub: 'u1', name: 'Test', email: 't@x' };

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
  dbUser?: { id: string; name: string; email: string; active: boolean } | null;
  /** Permissions the caller holds. */
  held?: string[];
  /** Permissions the route will require once enforcement switches. */
  required?: string[];
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
      ? { id: user.sub, name: user.name, email: user.email, active: true }
      : opts.dbUser;
  const db = { users: () => ({ findOne: async () => dbUser }) } as any;
  const perms = {
    forUser: async () => new Set(opts.held ?? []),
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
      dbUser: { id: 'u1', name: 'Test', email: 't@x', active: false },
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

  it('answers from the database, so revoking access does not wait for expiry', async () => {
    // This used to check that a promotion in the DB beat a stale role claim.
    // The token no longer carries authority at all, so the same property is
    // now about the other direction, which is the one that matters: a token
    // minted while somebody could do something must stop working the moment
    // the database says they cannot.
    const stillAllowed = makeGuard({ held: ['devices.delete'], required: ['devices.delete'] });
    await expect(stillAllowed.canActivate(makeCtx({ authorization: 'Bearer x' }))).resolves.toBe(
      true,
    );

    const revoked = makeGuard({ held: [], required: ['devices.delete'] });
    await expect(revoked.canActivate(makeCtx({ authorization: 'Bearer x' }))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
