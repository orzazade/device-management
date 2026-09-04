import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collapses the two administrative tiers into one.
 *
 * The previous design kept an Administrator that ran the lab but could not
 * change who can do what, with access control reserved for Super Admin. That
 * separation is dropped: whoever administers the lab now administers access to
 * it too, and Super Admin is the single administrative role.
 *
 * Every Administrator becomes a Super Admin, so nobody loses anything —
 * although they do GAIN role management, which is the whole point of the
 * change and worth being explicit about.
 *
 * Deleted outright rather than soft-deleted. A soft-deleted role would still
 * be joined by any query that forgot the `deleted_at IS NULL` predicate, and
 * the permission resolver's correctness should not rest on every future query
 * remembering it. Its user_roles and role_permissions rows go with it by
 * cascade, after the holders have been moved.
 */
export class DropAdministratorRole1726400000000 implements MigrationInterface {
  name = 'DropAdministratorRole1726400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const superRole = await queryRunner.query(
      `SELECT id FROM roles WHERE name = 'Super Admin' AND deleted_at IS NULL LIMIT 1`,
    );
    const adminRole = await queryRunner.query(
      `SELECT id FROM roles WHERE name = 'Administrator' LIMIT 1`,
    );
    // Nothing to do on a database seeded after this change.
    if (!superRole.length || !adminRole.length) return;
    const superId = superRole[0].id;
    const adminId = adminRole[0].id;

    // Move the holders FIRST. Dropping the role first would cascade their
    // rows away and leave those accounts with no administrative role at all —
    // locked out of their own lab, with no record of what they had.
    await queryRunner.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by_id)
       SELECT ur.user_id, $1, ur.granted_by_id
       FROM user_roles ur
       WHERE ur.role_id = $2
       ON CONFLICT DO NOTHING`,
      [superId, adminId],
    );

    // Super Admin now holds everything, access control included. Re-granting
    // is idempotent, and covers a database whose Super Admin row was seeded
    // before a later release added permissions.
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, p.id FROM permissions p
       ON CONFLICT DO NOTHING`,
      [superId],
    );

    await queryRunner.query(`DELETE FROM roles WHERE id = $1`, [adminId]);

    await queryRunner.query(
      `UPDATE roles
       SET description = $2, updated_at = now()
       WHERE id = $1`,
      [
        superId,
        'Unrestricted. Runs the lab and decides who can do what — the only role that can create roles or assign them.',
      ],
    );
  }

  public async down(): Promise<void> {
    // Not reversible: once the tiers are merged there is no record of which
    // Super Admins used to be plain Administrators, and guessing would hand
    // back — or take away — access on no evidence. Recreate the role and
    // assign it deliberately if the split is ever wanted again.
  }
}
