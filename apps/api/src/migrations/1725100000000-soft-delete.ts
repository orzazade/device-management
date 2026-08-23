import { MigrationInterface, QueryRunner } from 'typeorm';

// Soft delete for master records (devices, projects, users): rows get a
// deleted_at stamp, vanish from lists, and stay restorable. History is
// never destroyed — this is an audit-first system.
export class SoftDelete1725100000000 implements MigrationInterface {
  name = 'SoftDelete1725100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devices ADD COLUMN deleted_at timestamptz`);
    await queryRunner.query(`ALTER TABLE projects ADD COLUMN deleted_at timestamptz`);
    await queryRunner.query(`ALTER TABLE users ADD COLUMN deleted_at timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devices DROP COLUMN deleted_at`);
    await queryRunner.query(`ALTER TABLE projects DROP COLUMN deleted_at`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN deleted_at`);
  }
}
