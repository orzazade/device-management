import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { writeAudit } from '../audit/audit';
import { AppDbContext } from '../db/app-db-context';
import { AuthUser, Public } from './auth.guard';
import { IDENTITY_PROVIDER, IdentityProvider } from './identity-provider';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

/** Known factory-default credentials; using one forces a change at login. */
const DEFAULT_PASSWORDS = ['admin123'];

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

@Controller('auth')
export class AuthController {
  // In-memory brute-force brake, per email. Fine for a single replica;
  // a shared store comes with the LDAP/multi-replica era.
  private readonly fails = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly jwt: JwtService,
    private readonly db: AppDbContext,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const key = dto.email.toLowerCase().trim();
    const gate = this.fails.get(key);
    if (gate && gate.lockedUntil > Date.now()) {
      const mins = Math.ceil((gate.lockedUntil - Date.now()) / 60_000);
      throw new HttpException(
        `Too many wrong attempts — try again in ${mins} min`,
        429,
      );
    }

    const user = await this.identity.verify(dto.email, dto.password);
    if (!user) {
      const next = { count: (gate?.count ?? 0) + 1, lockedUntil: 0 };
      if (next.count >= MAX_FAILS) {
        next.lockedUntil = Date.now() + LOCK_MS;
        next.count = 0;
      }
      this.fails.set(key, next);
      throw new UnauthorizedException('Wrong email or password');
    }
    this.fails.delete(key);
    await this.db.withTransaction(async (ctx) => {
      await writeAudit(ctx.manager, { id: user.id, name: user.name }, {
        entityType: 'user',
        entityId: user.id,
        action: 'signed_in',
        newValue: { email: user.email },
      });
    });

    const payload: AuthUser = {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      // Shipping-default credentials must not survive first contact.
      mustChangePassword: DEFAULT_PASSWORDS.includes(dto.password),
    };
  }

  @Post('change-password')
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: { user: AuthUser }) {
    if (DEFAULT_PASSWORDS.includes(dto.newPassword)) {
      throw new BadRequestException('That password is the factory default — pick your own');
    }
    if (!/[A-Za-z]/.test(dto.newPassword) || !/\d/.test(dto.newPassword)) {
      throw new BadRequestException('Password needs at least 8 characters with letters and numbers');
    }
    return this.db.withTransaction(async (ctx) => {
      const user = await ctx.users
        .createQueryBuilder('u')
        .addSelect('u.passwordHash')
        .where('u.id = :id', { id: req.user.sub })
        .getOne();
      if (!user) throw new UnauthorizedException();
      const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!ok) throw new UnauthorizedException('Current password is wrong');
      user.passwordHash = bcrypt.hashSync(dto.newPassword, 10);
      await ctx.users.save(user);
      await writeAudit(ctx.manager, { id: user.id, name: user.name }, {
        entityType: 'user',
        entityId: user.id,
        action: 'password_changed',
        newValue: { by: 'self' },
      });
      return { ok: true };
    });
  }

  @Get('me')
  me(@Req() req: { user: AuthUser }) {
    const { sub, name, email, role } = req.user;
    return { id: sub, name, email, role };
  }
}
