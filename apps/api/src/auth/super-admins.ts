import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SYSTEM_ROLES } from './permissions';

/**
 * Who holds Super Admin — the one place that question is answered.
 *
 * Until step 5 this was asked four different ways, each reading the legacy
 * `users.role` column: two lockout guards, the delete guard, and the audience
 * for lab-wide notifications. Once roles moved into their own tables that
 * column was a copy of the truth rather than the truth, and a copy that four
 * places read independently is a copy that will eventually disagree with the
 * original in one of them.
 *
 * Soft-deleted and deactivated accounts are excluded everywhere here. Both
 * uses need the same thing — somebody who can actually sign in and act. A
 * deactivated Super Admin cannot answer a notification, and must not be
 * counted as the reason it is safe to demote the last active one.
 */
async function activeHolderIds(manager: EntityManager): Promise<string[]> {
  const rows: { user_id: string }[] = await manager.query(
    `SELECT ur.user_id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
       JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL AND u.active
      WHERE r.name = $1`,
    [SYSTEM_ROLES.superAdmin.name],
  );
  return rows.map((r) => r.user_id);
}

/** Active Super Admin ids — the desk, and the audience for lab events. */
export async function superAdminIds(manager: EntityManager): Promise<string[]> {
  return activeHolderIds(manager);
}

/** Whether this account holds Super Admin right now. */
export async function holdsSuperAdmin(
  manager: EntityManager,
  userId: string,
): Promise<boolean> {
  const holders = await activeHolderIds(manager);
  return holders.includes(userId);
}

/**
 * Refuse an action that would leave nobody able to administer the lab.
 *
 * `userId` is the account about to lose the role (by demotion, deactivation
 * or deletion). It is safe only while somebody ELSE still holds it — counting
 * holders and comparing against one would also accept a second row belonging
 * to the same person, which `user_roles` cannot currently produce but which a
 * future change could.
 */
export async function assertNotTheLastSuperAdmin(
  manager: EntityManager,
  userId: string,
  refusal: string,
): Promise<void> {
  const holders = await activeHolderIds(manager);
  if (!holders.includes(userId)) return;
  if (holders.some((id) => id !== userId)) return;
  throw new ConflictException(refusal);
}
