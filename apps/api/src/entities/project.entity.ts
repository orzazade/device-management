import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Unique per kind (partial index in the squads migration), not table-wide.
  @Column()
  name: string;

  @Column({ default: '' })
  description: string;

  /** 'project' (a product/app) or 'squad' (a team). One table, one set of
   * delete/restore/attach rules for both. */
  @Column({ default: 'project' })
  kind: 'project' | 'squad';

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
