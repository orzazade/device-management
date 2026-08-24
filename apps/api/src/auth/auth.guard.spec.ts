import { describe, expect, it } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthGuard, AuthUser } from './auth.guard';

const user: AuthUser = { sub: 'u1', name: 'Test', email: 't@x', role: 'tester' };

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
}) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === 'isPublic' ? (opts.isPublic ?? false) : opts.roles,
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
  return new AuthGuard(jwt, reflector, db);
}

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

  it('rejects a valid user with the wrong role', async () => {
    const g = makeGuard({ roles: ['admin'] });
    await expect(g.canActivate(makeCtx({ authorization: 'Bearer x' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('accepts a valid user with an allowed role and attaches it', async () => {
    const g = makeGuard({ roles: ['tester', 'manager'] });
    const ctx = makeCtx({ authorization: 'Bearer x' });
    await expect(g.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.req.user).toEqual(user);
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
