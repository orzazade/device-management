import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column()
  event: string;

  @Column()
  text: string;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  meta: Record<string, string>;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('notification_rules')
export class NotificationRule {
  @Column({ primary: true })
  event: string;

  @Column()
  label: string;

  @Column({ default: true })
  inapp: boolean;

  @Column({ default: false })
  email: boolean;
}

export type OutboxState = 'pending' | 'sent' | 'failed';

@Entity('email_outbox')
export class EmailOutbox {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column()
  toEmail: string;

  @Column()
  subject: string;

  @Column()
  body: string;

  @Column({ type: 'varchar', default: 'pending' })
  state: OutboxState;

  @Column({ default: 0 })
  attempts: number;

  @Column({ type: 'varchar', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  /** Earliest time the next send attempt may run — exponential backoff,
   * and also the claim marker that keeps overlapping drains off a row. */
  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
