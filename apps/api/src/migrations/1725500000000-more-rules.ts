import { MigrationInterface, QueryRunner } from 'typeorm';

/** Rules for the two events that previously notified nobody. */
export class MoreRules1725500000000 implements MigrationInterface {
  name = 'MoreRules1725500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO notification_rules (event, label, inapp, email) VALUES
        ('request_time_changed', 'Booking time changed', true, true),
        ('request_cancelled',    'Request cancelled',    true, false)
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM notification_rules WHERE event IN ('request_time_changed', 'request_cancelled')`,
    );
  }
}
