import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn()
  key: string;

  @Column()
  value: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
