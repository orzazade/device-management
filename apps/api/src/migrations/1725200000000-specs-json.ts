import { MigrationInterface, QueryRunner } from 'typeorm';

// Specs grow up: from one free-text line to a structured JSON object
// (chipset, ram, storage, display, connectivity, …). Old text is preserved
// under specs.notes — nothing is lost.
export class SpecsJson1725200000000 implements MigrationInterface {
  name = 'SpecsJson1725200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE devices ADD COLUMN specs_json jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `UPDATE devices SET specs_json = jsonb_build_object('notes', specs) WHERE specs <> ''`,
    );
    await queryRunner.query(`ALTER TABLE devices DROP COLUMN specs`);
    await queryRunner.query(`ALTER TABLE devices RENAME COLUMN specs_json TO specs`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devices ADD COLUMN specs_text varchar NOT NULL DEFAULT ''`);
    await queryRunner.query(`UPDATE devices SET specs_text = COALESCE(specs->>'notes', '')`);
    await queryRunner.query(`ALTER TABLE devices DROP COLUMN specs`);
    await queryRunner.query(`ALTER TABLE devices RENAME COLUMN specs_text TO specs`);
  }
}
