import {
  BadRequestException,
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
  Put,
  Req,
} from '@nestjs/common';
import { ArrayUnique, IsArray, IsOptional, IsString, Length } from 'class-validator';
import { In } from 'typeorm';
import { writeAudit } from '../audit/audit';
import { AppDbContext } from '../db/app-db-context';
import { Permission, Role } from '../entities/rbac.entity';
import { AuthUser, RequirePermission } from './auth.guard';
import { ACCESS_CONTROL_KEYS, SYSTEM_ROLES, withDependencies } from './permissions';

class RoleDto {
  @IsString()
  @Length(2, 60)
  name: string;

  @IsOptional()
  @IsString()
  @Length(0, 400)
  description?: string;
}

class PermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  keys: string[];
}

class UserRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds: string[];
}

const actor = (req: { user: AuthUser }) => ({ id: req.user.sub, name: req.user.name });

/** What a role looks like over the wire. */
const pub = (r: Role, holders = 0) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  isSystem: r.isSystem,
  permissions: (r.permissions ?? []).map((p) => p.key).sort(),
  holders,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/**
 * Managing roles and who holds them.
 *
 * Every route here needs a `roles.*` permission, which only Super Admin has
 * and which can never be granted to a custom role — so this whole controller
 * is out of reach for anyone else. That is the escalation guard: not a
 * comparison that has to be right, but a door that does not open.
 */
@Controller()
export class RolesController {
  constructor(private readonly db: AppDbContext) {}

  // ------------------------------------------------------------ catalogue

  /** The permission catalogue, grouped the way the editor's tree renders. */
  @Get('permissions')
  @RequirePermission('roles.view')
  async catalogue() {
    const all = await this.db.permissions().find({
      order: { sortOrder: 'ASC' },
    });
    const modules: {
      module: string;
      features: { feature: string; permissions: Permission[] }[];
    }[] = [];
    for (const p of all) {
      let mod = modules.find((m) => m.module === p.module);
      if (!mod) modules.push((mod = { module: p.module, features: [] }));
      let feat = mod.features.find((f) => f.feature === p.feature);
      if (!feat) mod.features.push((feat = { feature: p.feature, permissions: [] }));
      feat.permissions.push(p);
    }
    return {
      modules: modules.map((m) => ({
        module: m.module,
        features: m.features.map((f) => ({
          feature: f.feature,
          permissions: f.permissions.map((p) => ({
            key: p.key,
            name: p.name,
            description: p.description,
          })),
        })),
      })),
      // The editor ticks these for the administrator and explains why, and
      // the API applies the same closure on save — so a role assembled by a
      // direct call ends up identical to one built in the UI.
      dependencies: Object.fromEntries(
        all
          .map((p) => [p.key, withDependencies([p.key]).filter((k) => k !== p.key)])
          .filter(([, needs]) => (needs as string[]).length),
      ),
      /** Never grantable to a custom role — the editor greys these out. */
      reserved: ACCESS_CONTROL_KEYS,
    };
  }

  // ---------------------------------------------------------------- roles

  @Get('roles')
  @RequirePermission('roles.view')
  async list() {
    const roles = await this.db.roles().find({
      relations: { permissions: true },
      order: { isSystem: 'DESC', name: 'ASC' },
    });
    const counts = await this.holderCounts(roles.map((r) => r.id));
    return roles.map((r) => pub(r, counts.get(r.id) ?? 0));
  }

  @Get('roles/:id')
  @RequirePermission('roles.view')
  async get(@Param('id') id: string) {
    const role = await this.load(id);
    const counts = await this.holderCounts([role.id]);
    return pub(role, counts.get(role.id) ?? 0);
  }

  @Post('roles')
  @RequirePermission('roles.create')
  async create(@Body() dto: RoleDto, @Req() req: { user: AuthUser }) {
    return this.db.withTransaction(async (ctx) => {
      await this.assertNameFree(dto.name);
      const role = await ctx.roles.save({
        name: dto.name.trim(),
        description: dto.description?.trim() ?? '',
        isSystem: false,
      });
      await writeAudit(ctx.manager, actor(req), {
        entityType: 'role',
        entityId: role.id,
        action: 'created',
        newValue: { name: role.name },
      });
      return pub({ ...role, permissions: [] } as Role, 0);
    });
  }

  @Post('roles/:id/duplicate')
  @RequirePermission('roles.create')
  async duplicate(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    const source = await this.load(id);
    return this.db.withTransaction(async (ctx) => {
      // "Copy" then "Copy 2" — mirroring a role to tweak it is the common way
      // a second one gets made, and failing on a name clash would be a poor
      // reward for clicking Duplicate.
      let name = `${source.name} copy`;
      for (let n = 2; await ctx.roles.findOne({ where: { name } }); n++) {
        name = `${source.name} copy ${n}`;
      }
      const copy = await ctx.roles.save({
        name,
        description: source.description,
        isSystem: false,
        // A copy of Super Admin must not smuggle access control out of it.
        permissions: source.permissions.filter((p) => !ACCESS_CONTROL_KEYS.includes(p.key)),
      });
      await writeAudit(ctx.manager, actor(req), {
        entityType: 'role',
        entityId: copy.id,
        action: 'created',
        newValue: { name: copy.name, copiedFrom: source.name },
      });
      return pub(copy, 0);
    });
  }

  @Patch('roles/:id')
  @RequirePermission('roles.update')
  async rename(@Param('id') id: string, @Body() dto: RoleDto, @Req() req: { user: AuthUser }) {
    const role = await this.load(id);
    if (role.isSystem) {
      throw new ForbiddenException(`${role.name} is a built-in role and cannot be renamed`);
    }
    return this.db.withTransaction(async (ctx) => {
      await this.assertNameFree(dto.name, role.id);
      const before = { name: role.name, description: role.description };
      role.name = dto.name.trim();
      if (dto.description !== undefined) role.description = dto.description.trim();
      await ctx.roles.save(role);
      await writeAudit(ctx.manager, actor(req), {
        entityType: 'role',
        entityId: role.id,
        action: 'updated',
        oldValue: before,
        newValue: { name: role.name, description: role.description },
      });
      return pub(role);
    });
  }

  /**
   * Replace a role's permissions wholesale.
   *
   * PUT rather than add/remove because the editor saves a whole tree of
   * checkboxes at once: a replace matches what the person actually did, and
   * cannot leave a half-applied state if one call in a sequence fails.
   */
  @Put('roles/:id/permissions')
  @RequirePermission('roles.update')
  async setPermissions(
    @Param('id') id: string,
    @Body() dto: PermissionsDto,
    @Req() req: { user: AuthUser },
  ) {
    const role = await this.load(id);
    if (role.isSystem && role.name === SYSTEM_ROLES.superAdmin.name) {
      throw new ForbiddenException(
        'Super Admin always holds every permission — it cannot be narrowed',
      );
    }

    const reserved = dto.keys.filter((k) => ACCESS_CONTROL_KEYS.includes(k));
    if (reserved.length) {
      throw new ForbiddenException(
        `Access control stays with Super Admin — ${reserved.join(', ')} cannot be granted to another role`,
      );
    }

    // Same closure the editor applies, enforced here so a raw API call cannot
    // build a role the UI could not.
    const wanted = withDependencies(dto.keys);
    const rows = await this.db.permissions().find({ where: { key: In(wanted) } });
    const missing = wanted.filter((k) => !rows.some((p) => p.key === k));
    if (missing.length) {
      throw new BadRequestException(`Unknown permission: ${missing.join(', ')}`);
    }

    return this.db.withTransaction(async (ctx) => {
      const had = new Set(role.permissions.map((p) => p.key));
      const now = new Set(rows.map((p) => p.key));
      role.permissions = rows;
      await ctx.roles.save(role);

      const added = [...now].filter((k) => !had.has(k)).sort();
      const removed = [...had].filter((k) => !now.has(k)).sort();
      if (added.length || removed.length) {
        // Added/removed rather than the whole set: a diff of two keys is
        // readable in the audit log, a dump of forty is not.
        await writeAudit(ctx.manager, actor(req), {
          entityType: 'role',
          entityId: role.id,
          action: 'permissions_changed',
          oldValue: { removed },
          newValue: { added, total: now.size },
        });
      }
      return pub(role);
    });
  }

  @Delete('roles/:id')
  @RequirePermission('roles.delete')
  async remove(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    const role = await this.load(id);
    if (role.isSystem) {
      throw new ForbiddenException(`${role.name} is a built-in role and cannot be deleted`);
    }
    const holders = (await this.holderCounts([role.id])).get(role.id) ?? 0;
    if (holders > 0) {
      // Cascading would work; silently stripping access from a dozen people
      // because somebody tidied up a role is exactly the surprise this system
      // exists to prevent.
      throw new ConflictException(
        `${holders} ${holders === 1 ? 'person holds' : 'people hold'} this role — take it off them first`,
      );
    }
    return this.db.withTransaction(async (ctx) => {
      await ctx.roles.softDelete(role.id);
      await writeAudit(ctx.manager, actor(req), {
        entityType: 'role',
        entityId: role.id,
        action: 'deleted',
        oldValue: { name: role.name, permissions: role.permissions.length },
      });
      return { ok: true };
    });
  }

  // ------------------------------------------------------- who holds what

  @Put('users/:id/roles')
  @RequirePermission('users.roles.assign')
  async assign(
    @Param('id') id: string,
    @Body() dto: UserRolesDto,
    @Req() req: { user: AuthUser },
  ) {
    if (id === req.user.sub) {
      // Without this, "can manage users" is one click from "can do anything".
      throw new ForbiddenException(
        'You cannot change your own roles — ask another Super Admin',
      );
    }
    const user = await this.db.users().findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const roles = await this.db.roles().find({ where: { id: In(dto.roleIds) } });
    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestException('One of those roles no longer exists');
    }

    const superRole = roles.find((r) => r.name === SYSTEM_ROLES.superAdmin.name);
    if (!superRole) await this.assertNotLastSuperAdmin(id);

    return this.db.withTransaction(async (ctx) => {
      const before = await ctx.userRoles.find({ where: { userId: id } });
      const had = new Set(before.map((r: { roleId: string }) => r.roleId));
      await ctx.userRoles.delete({ userId: id });
      for (const role of roles) {
        await ctx.userRoles.save({
          userId: id,
          roleId: role.id,
          grantedById: req.user.sub,
        });
      }
      // Keep the legacy column in step. Until step 5 removes it, two paths
      // can change what somebody may do — this one and PATCH /users/:id/role
      // — and letting them disagree would mean the answer depended on which
      // screen you happened to use.
      const isAdmin = roles.some((r) => r.name === SYSTEM_ROLES.superAdmin.name);
      await ctx.users.update(id, { role: isAdmin ? 'admin' : 'tester' });

      const names = roles.map((r) => r.name).sort();
      if (had.size !== roles.length || roles.some((r) => !had.has(r.id))) {
        // Recorded against the USER, not the role: "how did this account get
        // this access?" should be answerable from one place.
        await writeAudit(ctx.manager, actor(req), {
          entityType: 'user',
          entityId: id,
          action: 'roles_assigned',
          oldValue: { roles: before.length },
          newValue: { roles: names },
        });
      }
      return { id, roles: names };
    });
  }

  // -------------------------------------------------------------- helpers

  private async load(id: string): Promise<Role> {
    const role = await this.db
      .roles()
      .findOne({ where: { id }, relations: { permissions: true } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private async holderCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows: { role_id: string; n: string }[] = await this.db
      .userRoles()
      .createQueryBuilder('ur')
      .innerJoin('users', 'u', 'u.id = ur.user_id AND u.deleted_at IS NULL')
      .where('ur.role_id IN (:...ids)', { ids })
      .select('ur.role_id', 'role_id')
      .addSelect('COUNT(*)', 'n')
      .groupBy('ur.role_id')
      .getRawMany();
    return new Map(rows.map((r) => [r.role_id, Number(r.n)]));
  }

  /**
   * Compared case-insensitively, because `idx_roles_name_live` is.
   *
   * An exact match would let "lab tester" past this check and straight into
   * the unique index, turning a name clash the administrator can fix into a
   * 500 they can only report.
   */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.db
      .roles()
      .createQueryBuilder('r')
      .where('lower(r.name) = lower(:name)', { name: name.trim() })
      .andWhere('r.deleted_at IS NULL')
      .andWhere(exceptId ? 'r.id != :exceptId' : '1=1', { exceptId })
      .getOne();
    if (clash) throw new ConflictException(`A role called "${clash.name}" already exists`);
  }

  /**
   * Refuse to take Super Admin off the last account holding it.
   *
   * There is no way back from an organisation with nobody who can grant
   * anything: recovery means a developer with database access.
   */
  private async assertNotLastSuperAdmin(userId: string): Promise<void> {
    const holders: { id: string }[] = await this.db
      .userRoles()
      .createQueryBuilder('ur')
      .innerJoin('roles', 'r', 'r.id = ur.role_id')
      .innerJoin('users', 'u', 'u.id = ur.user_id AND u.deleted_at IS NULL AND u.active')
      .where('r.name = :name', { name: SYSTEM_ROLES.superAdmin.name })
      .select('ur.user_id', 'id')
      .getRawMany();
    if (holders.length === 1 && holders[0].id === userId) {
      throw new ConflictException(
        'This is the last Super Admin — give somebody else the role first',
      );
    }
  }
}
