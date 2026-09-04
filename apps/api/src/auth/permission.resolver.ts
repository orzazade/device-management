import { Injectable, Logger } from '@nestjs/common';
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
 * Step 2 note: this runs on every request but nothing acts on the result yet.
 * The guard still enforces `users.role`; the resolver's job for now is to be
 * compared against that, so any disagreement surfaces as a log line while it
 * is still harmless.
 */
@Injectable()
export class PermissionResolver {
  private readonly log = new Logger('permissions');

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
   * Compare what the permission model would allow against what the legacy
   * role check actually allowed, and complain when they differ.
   *
   * This is the whole point of step 2. Switching enforcement blind would mean
   * discovering a mis-mapped endpoint in production, as a 403 for somebody
   * doing their job. Running both and logging the gap turns that into a log
   * line on a developer's machine, and "no warnings across a full suite run"
   * becomes the gate for step 3.
   */
  report(opts: {
    route: string;
    userId: string;
    role: string;
    legacyAllowed: boolean;
    required?: string[];
    held: Set<string>;
  }): void {
    const { route, userId, role, legacyAllowed, required, held } = opts;
    if (!required?.length) return;
    const modelAllows = required.every((key) => held.has(key));
    if (modelAllows === legacyAllowed) return;
    this.log.warn(
      `MISMATCH ${route} — role '${role}' ${legacyAllowed ? 'allows' : 'denies'} but ` +
        `permissions ${modelAllows ? 'allow' : 'deny'} ` +
        `(needs ${required.join(', ')}; user ${userId} holds ${held.size} permissions)`,
    );
  }
}
