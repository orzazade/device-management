import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { In } from 'typeorm';
import { writeAudit } from '../audit/audit';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { AuthUser, PermissionChange, RequirePermission } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';
import { Role, ROLES, User } from '../entities/user.entity';
import {
  ChangeUserRoleCommand,
  CreateUserCommand,
  UpdateUserCommand,
} from './users.commands';

class CreateUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsIn(ROLES)
  role: Role;

  @IsString()
  @MinLength(8)
  password: string;
}

class ChangeRoleDto {
  @IsIn(ROLES)
  role: Role;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  newPassword?: string;
}

const pub = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
});

const actor = (req: { user: AuthUser }) => ({ id: req.user.sub, name: req.user.name });

@Controller('users')
export class UsersController {
  constructor(
    private readonly db: AppDbContext,
    private readonly bus: CommandBus,
  ) {}

  @RequirePermission('users.view')
  @Get()
  async list(@Query('deleted') deleted?: string) {
    if (deleted === 'true') {
      const gone = await this.db
        .users()
        .createQueryBuilder('u')
        .withDeleted()
        .where('u.deletedAt IS NOT NULL')
        .orderBy('u.name')
        .getMany();
      return gone.map(pub);
    }
    const users = await this.db.users().find({ order: { name: 'ASC' } });
    // Who holds how many devices — the column the design reference had.
    const holds: { holder_id: string; n: string }[] = await this.db.devices().query(
      `SELECT holder_id, COUNT(*)::int AS n FROM devices
       WHERE holder_id IS NOT NULL AND deleted_at IS NULL GROUP BY holder_id`,
    );
    const byId = new Map(holds.map((h) => [h.holder_id, Number(h.n)]));
    // Which roles each person holds. One query for everyone rather than one
    // per row — the list is the whole team.
    const grants: { user_id: string; name: string }[] = await this.db.users().query(
      `SELECT ur.user_id, r.name FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
       ORDER BY r.is_system DESC, r.name`,
    );
    const rolesById = new Map<string, string[]>();
    for (const g of grants) {
      rolesById.set(g.user_id, [...(rolesById.get(g.user_id) ?? []), g.name]);
    }
    return users.map((u) => ({
      ...pub(u),
      holds: byId.get(u.id) ?? 0,
      roles: rolesById.get(u.id) ?? [],
    }));
  }

  @RequirePermission('users.delete')
  @Delete(':id')
  async softDelete(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      if (id === req.user.sub) throw new ConflictException('You cannot delete yourself');
      const user = await ctx.users.findOne({ where: { id } });
      if (!user) throw new NotFoundException('User not found');
      if (user.role === 'admin') {
        const admins = await ctx.users.count({ where: { role: 'admin', active: true } });
        if (admins <= 1) throw new ConflictException('Cannot delete the last Admin');
      }
      const holds = await ctx.devices.count({ where: { holderId: id } });
      if (holds > 0) {
        throw new ConflictException(`User still holds ${holds} device(s) — take them back first`);
      }
      const open = await ctx.requests.count({
        where: { requesterId: id, state: In(['pending', 'approved', 'active', 'overdue']) },
      });
      if (open > 0) {
        throw new ConflictException(`User has ${open} open request(s) — resolve them first`);
      }
      user.active = false;
      await ctx.users.save(user);
      await ctx.users.softDelete(id);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'user',
        entityId: id,
        action: 'deleted',
        oldValue: { name: user.name, email: user.email },
      });
      return { ok: true };
    });
  }

  @RequirePermission('users.restore')
  @Post(':id/restore')
  async restore(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const user = await ctx.users.findOne({ where: { id }, withDeleted: true });
      if (!user || !user.deletedAt) throw new NotFoundException('No deleted user with this id');
      await ctx.users.restore(id);
      user.deletedAt = null;
      // Deliberately NOT reactivated: restoring history must not silently
      // re-enable sign-in. The admin flips Active on explicitly.
      await ctx.users.save(user);
      await writeAudit(ctx.manager, { id: req.user.sub, name: req.user.name }, {
        entityType: 'user',
        entityId: id,
        action: 'restored',
        newValue: { name: user.name, email: user.email },
      });
      return { ok: true };
    });
  }

  @RequirePermission('users.create')
  @Post()
  async create(@Body() dto: CreateUserDto, @Req() req: { user: AuthUser }) {
    // A manager must not be able to mint accounts at or above their own
    // power — only an Admin creates Managers or Admins.
    if (dto.role !== 'tester' && req.user.role !== 'admin') {
      throw new ForbiddenException('Only an Admin can create Manager or Admin accounts');
    }
    const user: User = await this.bus.execute(new CreateUserCommand(actor(req), dto));
    return pub(user);
  }

  @RequirePermission('users.update')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: { user: AuthUser },
  ) {
    // Deactivating, resetting passwords or changing the email someone
    // signs in with is the Admin's call alone — refuse loudly.
    if (
      (dto.active !== undefined || dto.newPassword || dto.email !== undefined) &&
      req.user.role !== 'admin'
    ) {
      throw new ForbiddenException(
        'Only an Admin can deactivate users, reset passwords or change emails',
      );
    }
    // A manager must not edit anyone at or above their own rank.
    if (req.user.role !== 'admin') {
      const target = await this.db.users().findOne({ where: { id } });
      if (target && target.role !== 'tester' && target.id !== req.user.sub) {
        throw new ForbiddenException('Only an Admin can edit Manager or Admin accounts');
      }
    }
    const user: User = await this.bus.execute(new UpdateUserCommand(actor(req), id, dto));
    return pub(user);
  }

  @Patch(':id/role')
  @RequirePermission('users.roles.assign')
  @PermissionChange(
    'Role assignment moves to Super Admin at step 3 — ordinary Admins lose it, ' +
      'which is what keeps "can manage users" from becoming "can do anything".',
  )
  async changeRole(
    @Param('id') id: string,
    @Body() dto: ChangeRoleDto,
    @Req() req: { user: AuthUser },
  ) {
    const user: User = await this.bus.execute(
      new ChangeUserRoleCommand(actor(req), id, dto.role),
    );
    return pub(user);
  }
}
