import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only. No update/delete path exists anywhere in the code, and the
 * repository is only ever used for insert() and find().
 */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column()
  actorName: string;

  @Column()
  entityType: string;

  @Column()
  entityId: string;

  @Column()
  action: string;

  @Column({ type: 'jsonb', nullable: true })
  oldValue: unknown;

  @Column({ type: 'jsonb', nullable: true })
  newValue: unknown;

  @CreateDateColumn()
  createdAt: Date;
}
