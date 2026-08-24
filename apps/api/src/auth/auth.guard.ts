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
import { Role } from '../entities/user.entity';

export interface AuthUser {
  sub: string;
  name: string;
  email: string;
  role: Role;
}

export const PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Global guard: every route requires a valid Bearer token unless @Public().
 * @Roles(...) additionally restricts by role. The frontend only hides
 * buttons; this is the actual protection.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly db: AppDbContext,
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
    let claims: AuthUser;
    try {
      claims = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // The token only proves identity. Role and active-ness come from the DB
    // on every request, so deactivating/demoting someone takes effect NOW,
    // not when their 12h token expires. (find() skips soft-deleted users.)
    const dbUser = await this.db.users().findOne({ where: { id: claims.sub } });
    if (!dbUser || !dbUser.active) {
      throw new UnauthorizedException('Account is deactivated');
    }
    const user: AuthUser = {
      sub: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role,
    };
    req.user = user;

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
    }
    return true;
  }
}
