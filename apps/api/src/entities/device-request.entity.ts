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

export type RequestState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'returned'
  | 'overdue'
  | 'cancelled';

/** Legal transitions — the server enforces these; anything else is a 409. */
export const REQUEST_TRANSITIONS: Record<RequestState, RequestState[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['active', 'cancelled'],
  active: ['returned', 'overdue'],
  // 'active' = the loan was extended past today, so it is no longer late.
  overdue: ['returned', 'active'],
  rejected: [],
  returned: [],
  cancelled: [],
};

@Entity('requests')
export class DeviceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => Device)
  @JoinColumn({ name: 'device_id' })
  device: Device;

  /** Who will hold the device. */
  @Column({ type: 'uuid' })
  requesterId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'requester_id' })
  requester: User;

  /** Who created it (differs from requester for on-behalf requests). */
  @Column({ type: 'uuid' })
  createdById: string;

  @Column()
  reason: string;

  @Column({ type: 'date' })
  fromDate: string;

  @Column({ type: 'date' })
  toDate: string;

  @Column({ type: 'varchar', default: 'pending' })
  state: RequestState;

  @Column({ type: 'uuid', nullable: true })
  decidedById: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
