import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppDbContext } from '../db/app-db-context';
import { PermissionResolver } from './permission.resolver';

/**
 * What the signed token carries: identity, and nothing that can go stale.
 *
 * Permissions are deliberately absent. Putting them in a 12-hour token would
 * mean a revoked permission kept working until it expired — the exact
 * property the guard goes out of its way to avoid by re-reading the user on
 * every request.
 */
export interface TokenClaims {
  sub: string;
  name: string;
  email: string;
}

/** The caller, as handlers see them: identity plus freshly resolved permissions. */
export interface AuthUser extends TokenClaims {
  /** Effective permissions, resolved from the role tables on every request. */
  permissions: Set<string>;
}

export const PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
/**
 * The permissions this route will require once step 3 switches enforcement.
 *
 * During step 2 it enforces nothing: the guard resolves what the caller holds,
 * compares it against the @Roles verdict, and logs when the two disagree. That
 * turns a mis-mapped endpoint into a warning on a developer's machine rather
 * than a 403 for somebody trying to do their job.
 */
export const RequirePermission = (...keys: string[]) =>
  SetMetadata(PERMISSIONS_KEY, keys);

export const PERMISSION_CHANGE_KEY = 'permissionChange';
/**
 * Marks a route where the permission model is MEANT to differ from today's
 * role check, with the reason. Without this, an intended change would look
 * identical to a mapping bug in the logs and "no warnings" could never be a
 * clean gate for step 3.
 */
export const PermissionChange = (why: string) => SetMetadata(PERMISSION_CHANGE_KEY, why);

/**
 * Global guard: every route requires a valid Bearer token unless @Public(),
 * and every permission named by @RequirePermission() must be held. The
 * frontend only hides buttons; this is the actual protection.
 *
 * Two things it deliberately does NOT decide. Whether a particular record is
 * yours to act on — approving a request for a device you hold, cancelling
 * your own booking — is a relationship, settled in the handler. And routes
 * with no permission at all are reachable by anyone signed in, which is
 * checked to be intentional by route-coverage.spec.ts rather than left to
 * whoever reads the diff.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly db: AppDbContext,
    private readonly perms: PermissionResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers['authorization'] ?? '').replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException('Missing token');
    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // The token only proves identity. Permissions and active-ness come from the DB
    // on every request, so deactivating/demoting someone takes effect NOW,
    // not when their 12h token expires. (find() skips soft-deleted users.)
    const dbUser = await this.db.users().findOne({ where: { id: claims.sub } });
    if (!dbUser || !dbUser.active) {
      throw new UnauthorizedException('Account is deactivated');
    }
    // Resolved on every request for the same reason the role is: so a change
    // takes effect on the person's next click, not when their token expires.
    const held = await this.perms.forUser(dbUser.id);
    const user: AuthUser = {
      sub: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      permissions: held,
    };
    req.user = user;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required?.length) {
      const missing = required.filter((key) => !held.has(key));
      if (missing.length) {
        // Name what is missing. "Forbidden" with no reason turns a permission
        // problem into a support ticket, and the key is not a secret — the
        // person either holds it or does not.
        throw new ForbiddenException(`Requires permission: ${missing.join(', ')}`);
      }
    }

    return true;
  }
}
