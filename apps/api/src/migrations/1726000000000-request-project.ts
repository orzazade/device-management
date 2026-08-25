import { MigrationInterface, QueryRunner } from 'typeorm';

// A request names the project it serves. Nullable so history stays valid;
// the API requires it on every new request.
export class RequestProject1726000000000 implements MigrationInterface {
  name = 'RequestProject1726000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE requests ADD COLUMN project_id uuid NULL`);
    await queryRunner.query(
      `ALTER TABLE requests ADD CONSTRAINT fk_requests_project FOREIGN KEY (project_id) REFERENCES projects(id)`,
    );
    await queryRunner.query(`CREATE INDEX idx_requests_project ON requests(project_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_requests_project`);
    await queryRunner.query(`ALTER TABLE requests DROP CONSTRAINT IF EXISTS fk_requests_project`);
    await queryRunner.query(`ALTER TABLE requests DROP COLUMN IF EXISTS project_id`);
  }
}
