import { MigrationInterface, QueryRunner } from 'typeorm';

/** Rejections carry a reason the tester actually sees. */
export class DecisionNote1725600000000 implements MigrationInterface {
  name = 'DecisionNote1725600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE requests ADD COLUMN decision_note varchar NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE requests DROP COLUMN decision_note`);
  }
}
