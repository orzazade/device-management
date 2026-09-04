import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes `users.role`, the last copy of the access model.
 *
 * Nothing reads it any more: the guard resolves permissions from the role
 * tables on every request, the four "who is an admin?" lookups go through
 * `superAdminIds`, and role assignment happens only through
 * `PUT /users/:id/roles`. Keeping the column would leave a field that looks
 * authoritative, is trivially reachable from SQL, and answers a question the
 * application no longer asks — which is how a future change ends up reading
 * it and quietly disagreeing with `user_roles`.
 *
 * The safety check below is the point of doing this last. If any live account
 * has no role at all, dropping the column destroys the only record of what
 * they were, and the migration refuses rather than leaving somebody with an
 * account they can sign into and do nothing with. The backfill in
 * 1726500000000 exists to make that impossible; this verifies it held.
 */
export class DropUsersRole1726600000000 implements MigrationInterface {
  name = 'DropUsersRole1726600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const orphans: { id: string; email: string }[] = await queryRunner.query(
      `SELECT u.id, u.email
         FROM users u
        WHERE u.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)`,
    );
    if (orphans.length) {
      throw new Error(
        `Refusing to drop users.role: ${orphans.length} account(s) hold no role ` +
          `(${orphans.map((o) => o.email).join(', ')}). Give them one first — ` +
          `dropping the column would lose the only record of what they were.`,
      );
    }
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS role`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rebuilt from the role tables rather than defaulted, so rolling back
    // lands on the truth instead of making everybody a tester.
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar NOT NULL DEFAULT 'tester'`,
    );
    await queryRunner.query(
      `UPDATE users u SET role = 'admin'
         WHERE EXISTS (
           SELECT 1 FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
            WHERE ur.user_id = u.id AND r.name = 'Super Admin'
         )`,
    );
  }
}
