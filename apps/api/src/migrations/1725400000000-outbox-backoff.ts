import { MigrationInterface, QueryRunner } from 'typeorm';

export class OutboxBackoff1725400000000 implements MigrationInterface {
  name = 'OutboxBackoff1725400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE email_outbox ADD COLUMN next_attempt_at timestamptz NULL`,
    );
    // Give rows failed under the old 5-strikes-in-5-minutes rule another life.
    await queryRunner.query(
      `UPDATE email_outbox SET state = 'pending', attempts = 0 WHERE state = 'failed'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE email_outbox DROP COLUMN next_attempt_at`);
  }
}
