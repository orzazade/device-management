import { DataSource, DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { config } from '../config';
import { AppSetting } from '../entities/app-setting.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Device } from '../entities/device.entity';
import { DeviceRequest } from '../entities/device-request.entity';
import {
  EmailOutbox,
  Notification,
  NotificationRule,
} from '../entities/notification.entity';
import { Project } from '../entities/project.entity';
import { Repair } from '../entities/repair.entity';
import { User } from '../entities/user.entity';
import { Init1724500000000 } from '../migrations/1724500000000-init';
import { UsersAudit1724600000000 } from '../migrations/1724600000000-users-audit';
import { DevicesProjects1724700000000 } from '../migrations/1724700000000-devices-projects';
import { Requests1724800000000 } from '../migrations/1724800000000-requests';
import { Notifications1724900000000 } from '../migrations/1724900000000-notifications';
import { Repairs1725000000000 } from '../migrations/1725000000000-repairs';
import { SoftDelete1725100000000 } from '../migrations/1725100000000-soft-delete';
import { SpecsJson1725200000000 } from '../migrations/1725200000000-specs-json';
import { OneOpenLoan1725300000000 } from '../migrations/1725300000000-one-open-loan';
import { OutboxBackoff1725400000000 } from '../migrations/1725400000000-outbox-backoff';
import { MoreRules1725500000000 } from '../migrations/1725500000000-more-rules';

// camelCase in code, snake_case in the database — enforced globally here,
// never hand-written in entities.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: config.databaseUrl,
  entities: [
    AppSetting,
    User,
    AuditLog,
    Device,
    Project,
    DeviceRequest,
    Notification,
    NotificationRule,
    EmailOutbox,
    Repair,
  ],
  migrations: [
    Init1724500000000,
    UsersAudit1724600000000,
    DevicesProjects1724700000000,
    Requests1724800000000,
    Notifications1724900000000,
    Repairs1725000000000,
    SoftDelete1725100000000,
    SpecsJson1725200000000,
    OneOpenLoan1725300000000,
    OutboxBackoff1725400000000,
    MoreRules1725500000000,
  ],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  migrationsRun: true,
  logging: config.env === 'development' ? ['error', 'warn', 'migration'] : ['error', 'migration'],
};

export const AppDataSource = new DataSource(dataSourceOptions);
