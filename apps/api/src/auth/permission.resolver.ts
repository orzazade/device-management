import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AppDbContext } from '../db/app-db-context';

/**
 * Turns a user id into the set of permission keys they effectively hold.
 *
 * Effective permissions are the UNION of every role the person holds. A
 * permission granted twice is simply held once — set semantics, no counting
 * and no precedence. There is deliberately no "deny" grant: deny-overrides
 * rules are where role systems stop being possible to reason about, and
 * nothing in this product needs one.
 *
 * This is the only answer to "what may this person do?" — the guard reads it
 * on every request, so a role change takes effect on the next click rather
 * than when a token expires.
 */
@Injectable()
export class PermissionResolver {
  constructor(private readonly db: AppDbContext) {}

  /**
   * One query, joining user_roles -> role_permissions -> permissions.
   *
   * No cache. The guard already loads the user on every request, so this adds
   * a join to a query that was happening anyway — and an invalidation bug in
   * a permission cache is a security bug, not a performance one. Cache later
   * if measurement asks for it, not before.
   *
   * Soft-deleted roles are excluded: deleting a role must actually take its
   * permissions away.
   */
  async forUser(userId: string, manager?: EntityManager): Promise<Set<string>> {
    const rows: { key: string }[] = await this.db
      .userRoles(manager)
      .createQueryBuilder('ur')
      .innerJoin('roles', 'r', 'r.id = ur.role_id AND r.deleted_at IS NULL')
      .innerJoin('role_permissions', 'rp', 'rp.role_id = r.id')
      .innerJoin('permissions', 'p', 'p.id = rp.permission_id')
      .where('ur.user_id = :userId', { userId })
      .select('p.key', 'key')
      .distinct(true)
      .getRawMany();
    return new Set(rows.map((r) => r.key));
  }

  /**
   * The names of the roles somebody holds.
   *
   * Shown in the header and the user list, where a person needs to recognise
   * their own access. Permissions answer "may I?", names answer "who am I
   * here?" — and a list of forty keys is not an answer to the second.
   */
  async roleNamesForUser(userId: string, manager?: EntityManager): Promise<string[]> {
    const rows: { name: string }[] = await this.db
      .userRoles(manager)
      .createQueryBuilder('ur')
      .innerJoin('roles', 'r', 'r.id = ur.role_id AND r.deleted_at IS NULL')
      .where('ur.user_id = :userId', { userId })
      .select('r.name', 'name')
      .orderBy('r.is_system', 'DESC')
      .addOrderBy('r.name')
      .getRawMany();
    return rows.map((r) => r.name);
  }
}
