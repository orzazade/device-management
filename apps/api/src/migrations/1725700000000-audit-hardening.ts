import { MigrationInterface, QueryRunner } from 'typeorm';

/** Audit log grows forever — give lookups indexes, and make append-only
 * a database rule instead of a comment. */
export class AuditHardening1725700000000 implements MigrationInterface {
  name = 'AuditHardening1725700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id, id DESC)`,
    );
    await queryRunner.query(`CREATE INDEX idx_audit_actor ON audit_log (actor_name)`);
    await queryRunner.query(`CREATE INDEX idx_audit_created ON audit_log (created_at)`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_append_only
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER trg_audit_append_only ON audit_log`);
    await queryRunner.query(`DROP FUNCTION audit_log_append_only`);
    await queryRunner.query(`DROP INDEX idx_audit_entity`);
    await queryRunner.query(`DROP INDEX idx_audit_actor`);
    await queryRunner.query(`DROP INDEX idx_audit_created`);
  }
}
