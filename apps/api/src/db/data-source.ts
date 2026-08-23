import { DataSource, DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { config } from '../config';
import { AppSetting } from '../entities/app-setting.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Device } from '../entities/device.entity';
import { DeviceRequest } from '../entities/device-request.entity';
import { Project } from '../entities/project.entity';
import { User } from '../entities/user.entity';
import { Init1724500000000 } from '../migrations/1724500000000-init';
import { UsersAudit1724600000000 } from '../migrations/1724600000000-users-audit';
import { DevicesProjects1724700000000 } from '../migrations/1724700000000-devices-projects';
import { Requests1724800000000 } from '../migrations/1724800000000-requests';

// camelCase in code, snake_case in the database — enforced globally here,
// never hand-written in entities.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: config.databaseUrl,
  entities: [AppSetting, User, AuditLog, Device, Project, DeviceRequest],
  migrations: [
    Init1724500000000,
    UsersAudit1724600000000,
    DevicesProjects1724700000000,
    Requests1724800000000,
  ],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  migrationsRun: true,
  logging: config.env === 'development' ? ['error', 'warn', 'migration'] : ['error', 'migration'],
};

export const AppDataSource = new DataSource(dataSourceOptions);
