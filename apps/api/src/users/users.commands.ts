import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import * as bcrypt from 'bcryptjs';
import { In } from 'typeorm';
import { Actor, writeAudit } from '../audit/audit';
import { AppDbContext } from '../db/app-db-context';
import { SYSTEM_ROLES } from '../auth/permissions';
import { assertNotTheLastSuperAdmin } from '../auth/super-admins';
import { User } from '../entities/user.entity';

export class CreateUserCommand {
  constructor(
    readonly actor: Actor,
    readonly data: {
      name: string;
      email: string;
      password: string;
      /** Roles to grant. Empty means the baseline role alone. */
      roleIds?: string[];
    },
  ) {}
}

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, data }: CreateUserCommand): Promise<User> {
    return this.db.withTransaction(async (ctx) => {
      const email = data.email.toLowerCase().trim();
      const exists = await ctx.users.findOne({ where: { email } });
      if (exists) throw new ConflictException(`User ${email} already exists`);
      const user = await ctx.users.save({
        name: data.name,
        email,
        passwordHash: bcrypt.hashSync(data.password, 10),
      });
      // Always grant something. An account created with no role holds no
      // permissions at all — a person who can sign in and then find every
      // screen empty, which reads as a broken app rather than as a
      // deliberate restriction.
      const roles = data.roleIds?.length
        ? await ctx.roles.find({ where: { id: In(data.roleIds) } })
        : await ctx.roles.find({ where: { name: SYSTEM_ROLES.labTester.name } });
      if (!roles.length) throw new NotFoundException('That role no longer exists');
      for (const role of roles) {
        await ctx.userRoles.save({
          userId: user.id,
          roleId: role.id,
          grantedById: actor.id,
        });
      }
      await writeAudit(ctx.manager, actor, {
        entityType: 'user',
        entityId: user.id,
        action: 'created',
        newValue: {
          name: user.name,
          email: user.email,
          roles: roles.map((r) => r.name).sort(),
        },
      });
      return user;
    });
  }
}

export class UpdateUserCommand {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
    readonly data: {
      name?: string;
      email?: string;
      active?: boolean;
      newPassword?: string;
    },
  ) {}
}

@CommandHandler(UpdateUserCommand)
export class UpdateUserHandler implements ICommandHandler<UpdateUserCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, userId, data }: UpdateUserCommand): Promise<User> {
    return this.db.withTransaction(async (ctx) => {
      const user = await ctx.users.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (data.name !== undefined && data.name !== user.name) {
        before.name = user.name;
        after.name = data.name;
        user.name = data.name;
      }
      if (data.email !== undefined) {
        const email = data.email.toLowerCase().trim();
        if (email !== user.email) {
          const dup = await ctx.users.findOne({ where: { email } });
          if (dup) throw new ConflictException(`User ${email} already exists`);
          before.email = user.email;
          after.email = email;
          user.email = email;
        }
      }
      if (data.active !== undefined && data.active !== user.active) {
        if (data.active === false) {
          // Same guards as delete — a deactivated account cannot sign in,
          // so it must not silently strand devices or open requests.
          await assertNotTheLastSuperAdmin(
            ctx.manager,
            user.id,
            'Cannot deactivate the last active Super Admin',
          );
          const holds = await ctx.devices.count({ where: { holderId: user.id } });
          if (holds > 0) {
            throw new ConflictException(
              `${user.name} still holds ${holds} device(s) — take them back first`,
            );
          }
          const open = await ctx.requests.count({
            where: {
              requesterId: user.id,
              state: In(['pending', 'approved', 'active', 'overdue']),
            },
          });
          if (open > 0) {
            throw new ConflictException(
              `${user.name} has ${open} open request(s) — resolve them first`,
            );
          }
        }
        before.active = user.active;
        after.active = data.active;
        user.active = data.active;
      }
      if (data.newPassword) {
        user.passwordHash = bcrypt.hashSync(data.newPassword, 10);
        after.password = 'changed';
      }
      if (Object.keys(after).length === 0) return user;
      await ctx.users.save(user);
      await writeAudit(ctx.manager, actor, {
        entityType: 'user',
        entityId: user.id,
        action: 'updated',
        oldValue: before,
        newValue: after,
      });
      return user;
    });
  }
}

