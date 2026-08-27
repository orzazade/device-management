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
import { REDIS } from '../redis';
import type Redis from 'ioredis';
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
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly jwt: JwtService,
    private readonly db: AppDbContext,
    // Brute-force brake lives in Redis so every replica sees the same count.
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private failKey(email: string) {
    return `login:fails:${email}`;
  }
  private lockKey(email: string) {
    return `login:lock:${email}`;
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const key = dto.email.toLowerCase().trim();
    const lockedForMs = await this.redis.pttl(this.lockKey(key));
    if (lockedForMs > 0) {
      const mins = Math.ceil(lockedForMs / 60_000);
      throw new HttpException(
        `Too many wrong attempts — try again in ${mins} min`,
        429,
      );
    }

    const user = await this.identity.verify(dto.email, dto.password);
    if (!user) {
      const count = await this.redis.incr(this.failKey(key));
      if (count === 1) await this.redis.pexpire(this.failKey(key), LOCK_MS);
      if (count >= MAX_FAILS) {
        await this.redis.set(this.lockKey(key), '1', 'PX', LOCK_MS);
        await this.redis.del(this.failKey(key));
      }
      throw new UnauthorizedException('Wrong email or password');
    }
    await this.redis.del(this.failKey(key), this.lockKey(key));
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
