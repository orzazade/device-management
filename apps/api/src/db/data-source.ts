import { DataSource, DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { config } from '../config';
import { AppSetting } from '../entities/app-setting.entity';
import { Init1724500000000 } from '../migrations/1724500000000-init';

// camelCase in code, snake_case in the database — enforced globally here,
// never hand-written in entities.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: config.databaseUrl,
  entities: [AppSetting],
  migrations: [Init1724500000000],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  migrationsRun: true,
  logging: config.env === 'development' ? ['error', 'warn', 'migration'] : ['error', 'migration'],
};

export const AppDataSource = new DataSource(dataSourceOptions);
