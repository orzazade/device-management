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
import { AuthUser, Roles } from '../auth/auth.guard';
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

  @Get()
  @Roles('admin', 'manager')
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
    const users = await this.db.users().find({ order: { createdAt: 'ASC' } });
    return users.map(pub);
  }

  @Delete(':id')
  @Roles('admin')
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

  @Post(':id/restore')
  @Roles('admin')
  async restore(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      const user = await ctx.users.findOne({ where: { id }, withDeleted: true });
      if (!user || !user.deletedAt) throw new NotFoundException('No deleted user with this id');
      await ctx.users.restore(id);
      user.deletedAt = null;
      user.active = true;
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

  @Post()
  @Roles('admin', 'manager')
  async create(@Body() dto: CreateUserDto, @Req() req: { user: AuthUser }) {
    // A manager must not be able to mint accounts at or above their own
    // power — only an Admin creates Managers or Admins.
    if (dto.role !== 'tester' && req.user.role !== 'admin') {
      throw new ForbiddenException('Only an Admin can create Manager or Admin accounts');
    }
    const user: User = await this.bus.execute(new CreateUserCommand(actor(req), dto));
    return pub(user);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
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
  @Roles('admin')
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
