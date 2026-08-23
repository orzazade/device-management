import { MigrationInterface, QueryRunner } from 'typeorm';

export class Notifications1724900000000 implements MigrationInterface {
  name = 'Notifications1724900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notifications (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        event varchar NOT NULL,
        text varchar NOT NULL,
        meta jsonb NOT NULL DEFAULT '{}',
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_notifications_user ON notifications(user_id, read_at)`,
    );
    await queryRunner.query(`
      CREATE TABLE notification_rules (
        event varchar PRIMARY KEY,
        label varchar NOT NULL,
        inapp boolean NOT NULL DEFAULT true,
        email boolean NOT NULL DEFAULT false
      )
    `);
    await queryRunner.query(`
      INSERT INTO notification_rules (event, label, inapp, email) VALUES
        ('request_created',  'Request created',       true, true),
        ('request_approved', 'Request approved',      true, true),
        ('request_rejected', 'Request rejected',      true, false),
        ('handover_pending', 'Handover awaiting you', true, true),
        ('due_soon',         'Return due soon',       true, false),
        ('overdue',          'Return overdue',        true, true),
        ('repair_update',    'Repair status changed', true, false)
    `);
    await queryRunner.query(`
      CREATE TABLE email_outbox (
        id bigserial PRIMARY KEY,
        to_email varchar NOT NULL,
        subject varchar NOT NULL,
        body varchar NOT NULL,
        state varchar NOT NULL DEFAULT 'pending',
        attempts int NOT NULL DEFAULT 0,
        last_error varchar,
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_outbox_state ON email_outbox(state)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_outbox`);
    await queryRunner.query(`DROP TABLE notification_rules`);
    await queryRunner.query(`DROP TABLE notifications`);
  }
}
