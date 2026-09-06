import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcryptjs';

/**
 * Retire the factory seed admin in favour of two named, working accounts.
 *
 * `admin@devicedesk.local` was seeded with a factory-default password so the
 * app was usable on first boot. It is retired here in favour of two accounts
 * whose roles are explicit — a Super Admin and a Lab Tester — matching the
 * fixed accounts the QA suite already drives.
 *
 * Passwords come from QA_ADMIN_PASSWORD / QA_TESTER_PASSWORD when those are
 * set, and otherwise fall back to the values the suite uses, so a deployment
 * with no extra configuration still has a working login.
 *
 * SECURITY: the fallback passwords live in source control. A Super Admin whose
 * password is public is a back door — on any deployment that matters, set the
 * two env vars, or rotate both passwords after the first sign-in.
 *
 * Ordering is deliberate. The new Super Admin is created and granted its role
 * BEFORE the old admin is retired, so there is no instant at which the lab has
 * nobody who can administer it — the same invariant the last-Super-Admin guard
 * enforces at runtime.
 */
export class SeedWorkingAdmins1726700000000 implements MigrationInterface {
  name = 'SeedWorkingAdmins1726700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const accounts = [
      {
        name: 'QA Admin',
        email: 'qa.admin@devicedesk.local',
        role: 'Super Admin',
        password: process.env.QA_ADMIN_PASSWORD ?? 'E2eAdmin2026',
      },
      {
        name: 'QA Tester',
        email: 'qa.tester@devicedesk.local',
        role: 'Lab Tester',
        password: process.env.QA_TESTER_PASSWORD ?? 'E2eTester2026',
      },
    ];

    for (const acc of accounts) {
      const role: { id: string }[] = await queryRunner.query(
        `SELECT id FROM roles WHERE name = $1 AND deleted_at IS NULL`,
        [acc.role],
      );
      if (!role.length) {
        // The RBAC role migrations must have run first. Refusing here beats
        // seeding an account with no role — a person who can sign in and then
        // find every screen empty.
        throw new Error(
          `Cannot seed ${acc.email}: role "${acc.role}" does not exist yet.`,
        );
      }

      const hash = bcrypt.hashSync(acc.password, 10);
      // Upsert on the unique email: on a database that already holds this
      // account — the QA suite creates it as a fixture — reset it to a
      // known-good state instead of colliding.
      await queryRunner.query(
        `INSERT INTO users (name, email, password_hash, active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               active = true,
               deleted_at = NULL`,
        [acc.name, acc.email, hash],
      );
      await queryRunner.query(
        `INSERT INTO user_roles (user_id, role_id, granted_by_id)
         SELECT u.id, $2, NULL FROM users u WHERE u.email = $1
         ON CONFLICT DO NOTHING`,
        [acc.email, role[0].id],
      );
    }

    // Only now retire the factory admin — the new Super Admin already exists,
    // so the lab keeps an administrator across the change. Soft delete, so the
    // audit rows it authored still resolve to a name.
    await queryRunner.query(
      `UPDATE users
          SET active = false, deleted_at = now()
        WHERE email = 'admin@devicedesk.local' AND deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Bring the factory admin back, so a rollback still leaves an
    // administrator in place. The two named accounts are left as they are:
    // removing them on the way down could strand the lab with no Super Admin
    // at all, which is the one state this whole sequence exists to avoid.
    await queryRunner.query(
      `UPDATE users SET active = true, deleted_at = NULL
        WHERE email = 'admin@devicedesk.local'`,
    );
  }
}
