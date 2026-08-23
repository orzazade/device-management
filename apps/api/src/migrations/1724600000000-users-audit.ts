import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcryptjs';

// Users + append-only audit log. Seeds the first Admin so the app is usable
// right after boot (change the password on first login — S1 scope note).
export class UsersAudit1724600000000 implements MigrationInterface {
  name = 'UsersAudit1724600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        email varchar NOT NULL UNIQUE,
        password_hash varchar NOT NULL,
        role varchar NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE audit_log (
        id bigserial PRIMARY KEY,
        actor_id uuid,
        actor_name varchar NOT NULL,
        entity_type varchar NOT NULL,
        entity_id varchar NOT NULL,
        action varchar NOT NULL,
        old_value jsonb,
        new_value jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const hash = bcrypt.hashSync(process.env.SEED_ADMIN_PASSWORD ?? 'admin123', 10);
    await queryRunner.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Admin', 'admin@devicedesk.local', $1, 'admin')`,
      [hash],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE audit_log`);
    await queryRunner.query(`DROP TABLE users`);
  }
}
