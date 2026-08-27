import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from './project.entity';
import { User } from './user.entity';

export type DeviceStatus = 'available' | 'assigned' | 'in_repair' | 'retired';
export const DEVICE_STATUSES: DeviceStatus[] = [
  'available',
  'assigned',
  'in_repair',
  'retired',
];

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  brand: string;

  @Column()
  model: string;

  @Column()
  os: string;

  @Column({ default: '' })
  osVersion: string;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  specs: Record<string, unknown>;

  @Column({ unique: true })
  serial: string;

  @Column({ default: '' })
  imei: string;

  @Column({ type: 'varchar', default: 'available' })
  status: DeviceStatus;

  @Column({ type: 'varchar', nullable: true })
  damageNote: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  accessories: string[];

  @Column({ type: 'uuid', nullable: true })
  holderId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'holder_id' })
  holder: User | null;

  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => Project, { nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  /** The squad (team) this device belongs to — same table as projects. */
  @Column({ type: 'uuid', nullable: true })
  squadId: string | null;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'squad_id' })
  squad: Project | null;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
