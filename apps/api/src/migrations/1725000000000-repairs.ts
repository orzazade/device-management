import { MigrationInterface, QueryRunner } from 'typeorm';

export class Repairs1725000000000 implements MigrationInterface {
  name = 'Repairs1725000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE repairs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id uuid NOT NULL REFERENCES devices(id),
        reported_by_id uuid NOT NULL REFERENCES users(id),
        issue varchar NOT NULL,
        state varchar NOT NULL DEFAULT 'reported',
        closed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_repairs_device ON repairs(device_id)`);
    await queryRunner.query(`CREATE INDEX idx_repairs_state ON repairs(state)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE repairs`);
  }
}
