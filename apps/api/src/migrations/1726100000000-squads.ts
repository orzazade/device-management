import { MigrationInterface, QueryRunner } from 'typeorm';

// Squads: a second way to group devices, stored in the projects table with a
// kind column so delete/restore/attach logic is shared. Devices point at a
// squad via squad_id; the API requires a project OR a squad on new devices.
export class Squads1726100000000 implements MigrationInterface {
  name = 'Squads1726100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE projects ADD COLUMN kind varchar NOT NULL DEFAULT 'project'`);
    await queryRunner.query(`ALTER TABLE devices ADD COLUMN squad_id uuid NULL`);
    await queryRunner.query(
      `ALTER TABLE devices ADD CONSTRAINT fk_devices_squad FOREIGN KEY (squad_id) REFERENCES projects(id)`,
    );
    await queryRunner.query(`CREATE INDEX idx_devices_squad ON devices(squad_id)`);
    // Names are unique per KIND now (a squad and a project may share a name),
    // so the old table-wide unique on name has to go.
    await queryRunner.query(`DO $$
      DECLARE c text;
      BEGIN
        SELECT conname INTO c FROM pg_constraint
        WHERE conrelid = 'projects'::regclass AND contype = 'u' LIMIT 1;
        IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE projects DROP CONSTRAINT %I', c); END IF;
      END $$`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_kind_name ON projects(kind, LOWER(name)) WHERE deleted_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_devices_squad`);
    await queryRunner.query(`ALTER TABLE devices DROP CONSTRAINT IF EXISTS fk_devices_squad`);
    await queryRunner.query(`ALTER TABLE devices DROP COLUMN IF EXISTS squad_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_projects_kind_name`);
    await queryRunner.query(`ALTER TABLE projects DROP COLUMN IF EXISTS kind`);
    await queryRunner.query(`ALTER TABLE projects ADD CONSTRAINT uq_projects_name UNIQUE (name)`);
  }
}
