import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Device } from './device.entity';
import { User } from './user.entity';

export type RepairState =
  | 'reported'
  | 'repair_requested'
  | 'in_repair'
  | 'fixed'
  | 'written_off';

/** Legal transitions (GOALS.md repair lifecycle). */
export const REPAIR_TRANSITIONS: Record<RepairState, RepairState[]> = {
  reported: ['repair_requested'],
  repair_requested: ['in_repair', 'written_off'],
  in_repair: ['fixed', 'written_off'],
  fixed: [],
  written_off: [],
};

@Entity('repairs')
export class Repair {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => Device)
  @JoinColumn({ name: 'device_id' })
  device: Device;

  @Column({ type: 'uuid' })
  reportedById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reported_by_id' })
  reportedBy: User;

  @Column()
  issue: string;

  @Column({ type: 'varchar', default: 'reported' })
  state: RepairState;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
