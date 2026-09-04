import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  ACCESS_CONTROL_KEYS,
  ALL_PERMISSION_KEYS,
  LAB_TESTER_KEYS,
  PERMISSIONS,
} from '../auth/permissions';

// Names are frozen here rather than read from SYSTEM_ROLES: a migration is a
// record of what actually ran, and it must keep seeding what it seeded even
// after the constant moves on. The Administrator role it creates is retired
// by the next migration.
const SEEDED = {
  superAdmin: {
    name: 'Super Admin',
    description:
      'Unrestricted. The only role that can create roles, change what a role grants, or decide which roles a person holds.',
  },
  administrator: {
    name: 'Administrator',
    description:
      'Runs the lab: devices, users, repairs, projects, settings and the audit log. Cannot change who can do what.',
  },
  labTester: {
    name: 'Lab Tester',
    description:
      'Borrows devices, reports damage, and sees the lab’s inventory. The baseline every account starts from.',
  },
};
const ADMINISTRATOR_SEED = ALL_PERMISSION_KEYS.filter(
  (k) => !ACCESS_CONTROL_KEYS.includes(k),
);

/**
 * Step 1 of the RBAC rollout: the tables, the catalogue and the backfill.
 *
 * Nothing reads any of this yet. The AuthGuard still enforces `users.role`
 * exactly as before, so this migration changes no one's access — that is the
 * whole point of doing it as its own step. It is reversible.
 *
 * The backfill reproduces today's two roles precisely:
 *
 *   every `tester`  -> Lab Tester
 *   every `admin`   -> Administrator
 *   the seeded admin also gets Super Admin
 *
 * Only one account becomes Super Admin, and it is chosen by identity rather
 * than by "the oldest admin": promoting whichever row happens to sort first
 * is the kind of rule that quietly hands the keys to a test fixture. The
 * seeded operator account is the one real administrator; everything else in
 * this database is QA scaffolding. If that account is missing (a fresh
 * install), the oldest remaining admin is used, and if there is no admin at
 * all the migration leaves Super Admin unheld rather than inventing a holder.
 * Appointing a second Super Admin is a day-one task for the humans.
 */
export class RbacTables1726300000000 implements MigrationInterface {
  name = 'RbacTables1726300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------ tables
    await queryRunner.query(`
      CREATE TABLE permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar NOT NULL UNIQUE,
        name varchar NOT NULL,
        description text NOT NULL DEFAULT '',
        module varchar NOT NULL,
        feature varchar NOT NULL,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_permissions_tree ON permissions(module, feature, sort_order)`,
    );

    await queryRunner.query(`
      CREATE TABLE roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        description text NOT NULL DEFAULT '',
        is_system boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);
    // Unique per live row only — a soft-deleted role frees its name, the same
    // convention projects already use.
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_roles_name_live ON roles(lower(name)) WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE role_permissions (
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
        PRIMARY KEY (role_id, permission_id)
      )
    `);
    // "Who can do X?" is a real admin question and the PK does not serve it.
    await queryRunner.query(
      `CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE user_roles (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        granted_at timestamptz NOT NULL DEFAULT now(),
        granted_by_id uuid REFERENCES users(id),
        PRIMARY KEY (user_id, role_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_user_roles_role ON user_roles(role_id)`);

    // -------------------------------------------------------- catalogue
    // ON CONFLICT so this is safe to re-run and so a later migration that
    // adds permissions can reuse the same shape.
    for (const [i, p] of PERMISSIONS.entries()) {
      await queryRunner.query(
        `INSERT INTO permissions (key, name, description, module, feature, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (key) DO NOTHING`,
        [p.key, p.name, p.description, p.module, p.feature, i],
      );
    }

    // ----------------------------------------------------- system roles
    const roleId = async (name: string, description: string): Promise<string> => {
      const rows = await queryRunner.query(
        `INSERT INTO roles (name, description, is_system) VALUES ($1, $2, true)
         RETURNING id`,
        [name, description],
      );
      return rows[0].id;
    };
    const grant = async (id: string, keys: string[]): Promise<void> => {
      if (!keys.length) return;
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p WHERE p.key = ANY($2)
         ON CONFLICT DO NOTHING`,
        [id, keys],
      );
    };

    const superId = await roleId(SEEDED.superAdmin.name, SEEDED.superAdmin.description);
    const adminId = await roleId(SEEDED.administrator.name, SEEDED.administrator.description);
    const testerId = await roleId(SEEDED.labTester.name, SEEDED.labTester.description);

    // Grants are stored as rows rather than resolved by a rule at runtime, so
    // the database answers "what does this role allow?" on its own. The cost
    // is that a release adding a permission must also grant it to these two —
    // guarded by a test that asserts Super Admin holds every catalogue key.
    await grant(superId, ALL_PERMISSION_KEYS);
    await grant(adminId, ADMINISTRATOR_SEED);
    await grant(testerId, LAB_TESTER_KEYS);

    // Belt and braces: access control must never reach a non-super role.
    await queryRunner.query(
      `DELETE FROM role_permissions rp
       USING permissions p
       WHERE rp.permission_id = p.id
         AND p.key = ANY($1)
         AND rp.role_id <> $2`,
      [ACCESS_CONTROL_KEYS, superId],
    );

    // --------------------------------------------------------- backfill
    await queryRunner.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT id, $1 FROM users WHERE role = 'tester'
       ON CONFLICT DO NOTHING`,
      [testerId],
    );
    await queryRunner.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT id, $1 FROM users WHERE role = 'admin'
       ON CONFLICT DO NOTHING`,
      [adminId],
    );

    const seeded = await queryRunner.query(
      `SELECT id FROM users
       WHERE role = 'admin' AND deleted_at IS NULL
       ORDER BY (email = 'admin@devicedesk.local') DESC, created_at ASC
       LIMIT 1`,
    );
    if (seeded.length) {
      await queryRunner.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [seeded[0].id, superId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible on purpose: nothing reads these tables yet, so rolling back
    // is a clean drop rather than an access change.
    await queryRunner.query(`DROP TABLE IF EXISTS user_roles`);
    await queryRunner.query(`DROP TABLE IF EXISTS role_permissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS roles`);
    await queryRunner.query(`DROP TABLE IF EXISTS permissions`);
  }
}
