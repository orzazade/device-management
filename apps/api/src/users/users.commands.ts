import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import * as bcrypt from 'bcryptjs';
import { Actor, writeAudit } from '../audit/audit';
import { AppDbContext } from '../db/app-db-context';
import { Role, User } from '../entities/user.entity';

export class CreateUserCommand {
  constructor(
    readonly actor: Actor,
    readonly data: { name: string; email: string; role: Role; password: string },
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
        role: data.role,
        passwordHash: bcrypt.hashSync(data.password, 10),
      });
      await writeAudit(ctx.manager, actor, {
        entityType: 'user',
        entityId: user.id,
        action: 'created',
        newValue: { name: user.name, email: user.email, role: user.role },
      });
      return user;
    });
  }
}

export class ChangeUserRoleCommand {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
    readonly role: Role,
  ) {}
}

@CommandHandler(ChangeUserRoleCommand)
export class ChangeUserRoleHandler implements ICommandHandler<ChangeUserRoleCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, userId, role }: ChangeUserRoleCommand): Promise<User> {
    return this.db.withTransaction(async (ctx) => {
      const user = await ctx.users.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      const old = user.role;
      if (old === role) return user;
      user.role = role;
      await ctx.users.save(user);
      await writeAudit(ctx.manager, actor, {
        entityType: 'user',
        entityId: user.id,
        action: 'role_changed',
        oldValue: { role: old },
        newValue: { role },
      });
      return user;
    });
  }
}
