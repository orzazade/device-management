import { MigrationInterface, QueryRunner } from 'typeorm';

export class DevicesProjects1724700000000 implements MigrationInterface {
  name = 'DevicesProjects1724700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL UNIQUE,
        description varchar NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        brand varchar NOT NULL,
        model varchar NOT NULL,
        os varchar NOT NULL,
        os_version varchar NOT NULL DEFAULT '',
        specs varchar NOT NULL DEFAULT '',
        serial varchar NOT NULL UNIQUE,
        imei varchar NOT NULL DEFAULT '',
        status varchar NOT NULL DEFAULT 'available',
        damage_note varchar,
        accessories jsonb NOT NULL DEFAULT '[]',
        holder_id uuid REFERENCES users(id),
        project_id uuid REFERENCES projects(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_devices_status ON devices(status)`);
    await queryRunner.query(`CREATE INDEX idx_devices_holder ON devices(holder_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE devices`);
    await queryRunner.query(`DROP TABLE projects`);
  }
}
