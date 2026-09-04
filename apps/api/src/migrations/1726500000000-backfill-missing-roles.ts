import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives a role to any account that somehow has none.
 *
 * Accounts created between the RBAC tables landing and user creation learning
 * to grant a role have no `user_roles` row at all. Before enforcement went
 * live that was invisible; now it means the person signs in successfully and
 * then finds an application with nothing in it — not even the device list —
 * which reads as a broken product rather than a restricted account.
 *
 * The rule is the same one the original backfill used: the legacy column
 * decides. This is a safety net, not a policy — it should find nothing on a
 * database that has been through the whole sequence in order.
 */
export class BackfillMissingRoles1726500000000 implements MigrationInterface {
  name = 'BackfillMissingRoles1726500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Soft-deleted accounts are included on purpose: restoring one should
    // bring back a working account, not a person who can sign in and see
    // nothing.
    for (const [legacy, roleName] of [
      ['admin', 'Super Admin'],
      ['tester', 'Lab Tester'],
    ]) {
      await queryRunner.query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT u.id, r.id
         FROM users u
         CROSS JOIN roles r
         WHERE u.role = $1
           AND r.name = $2
           AND r.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
         ON CONFLICT DO NOTHING`,
        [legacy, roleName],
      );
    }
  }

  public async down(): Promise<void> {
    // Nothing to undo: this only ever adds a row that should have been there,
    // and removing it again would recreate the lockout it exists to fix.
  }
}
