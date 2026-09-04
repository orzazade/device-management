import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * One capability in the product.
 *
 * Seeded from PERMISSIONS in auth/permissions.ts and never written at
 * runtime — a permission is a code-level constant, and the table is a
 * queryable copy of it. That is what keeps the keys used in guards and the
 * rows the role editor lists from drifting apart.
 */
@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable machine key: 'devices.create'. Never renamed once shipped. */
  @Column({ unique: true })
  key: string;

  @Column()
  name: string;

  @Column({ default: '' })
  description: string;

  /** Top level of the tree in the role editor. */
  @Column()
  module: string;

  /** Second level of the tree. */
  @Column()
  feature: string;

  /** Keeps the tree in the order the catalogue declares, not alphabetical. */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;
}

/**
 * A named set of permissions.
 *
 * Two are seeded and marked `isSystem`: Super Admin and Lab Tester. Neither
 * can be deleted, and Super Admin's permissions cannot be edited — otherwise
 * one click could lock the organisation out of its own tool.
 */
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ default: '' })
  description: string;

  @Column({ default: false })
  isSystem: boolean;

  @ManyToMany(() => Permission, { cascade: false })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id' },
    inverseJoinColumn: { name: 'permission_id' },
  })
  permissions: Permission[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Soft delete, matching every other table in this schema. */
  @DeleteDateColumn()
  deletedAt: Date | null;
}

/**
 * Which roles a person holds.
 *
 * An explicit entity rather than a bare join table, because the grant itself
 * is worth recording: who handed it over and when. The audit log carries the
 * same event, but having it on the row means "how did this account get this
 * access?" is answerable without a log search.
 */
@Entity('user_roles')
export class UserRole {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @PrimaryColumn({ type: 'uuid' })
  roleId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @CreateDateColumn()
  grantedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  grantedById: string | null;
}
