import { MigrationInterface, QueryRunner } from 'typeorm';

/** A device can be physically out on at most ONE loan at a time. The
 * exclusion constraint can't enforce this once a loan runs past its
 * to_date (overdue), so back it with a partial unique index. */
export class OneOpenLoan1725300000000 implements MigrationInterface {
  name = 'OneOpenLoan1725300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_one_open_loan_per_device
      ON requests (device_id)
      WHERE state IN ('active', 'overdue')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX uq_one_open_loan_per_device`);
  }
}
