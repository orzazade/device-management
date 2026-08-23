import { MigrationInterface, QueryRunner } from 'typeorm';

// First migration: the settings table + the approval-mode flag (GOALS.md:
// launch policy 'all'; can flip to 'busy_only' without a code change).
export class Init1724500000000 implements MigrationInterface {
  name = 'Init1724500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE app_settings (
        key varchar PRIMARY KEY,
        value varchar NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `INSERT INTO app_settings (key, value) VALUES ('approval_mode', 'all')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE app_settings`);
  }
}
