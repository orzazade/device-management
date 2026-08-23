import { MigrationInterface, QueryRunner } from 'typeorm';

// Requests + the hard booking rule: Postgres itself refuses two overlapping
// approved/active/overdue bookings for one device (ARCH.md). App bugs cannot
// double-book.
export class Requests1724800000000 implements MigrationInterface {
  name = 'Requests1724800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await queryRunner.query(`
      CREATE TABLE requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id uuid NOT NULL REFERENCES devices(id),
        requester_id uuid NOT NULL REFERENCES users(id),
        created_by_id uuid NOT NULL REFERENCES users(id),
        reason varchar NOT NULL,
        from_date date NOT NULL,
        to_date date NOT NULL,
        state varchar NOT NULL DEFAULT 'pending',
        decided_by_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_range CHECK (from_date <= to_date),
        CONSTRAINT no_overlapping_bookings EXCLUDE USING gist (
          device_id WITH =,
          daterange(from_date, to_date, '[]') WITH &&
        ) WHERE (state IN ('approved', 'active', 'overdue'))
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_requests_state ON requests(state)`);
    await queryRunner.query(`CREATE INDEX idx_requests_requester ON requests(requester_id)`);
    await queryRunner.query(`CREATE INDEX idx_requests_device ON requests(device_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE requests`);
  }
}
