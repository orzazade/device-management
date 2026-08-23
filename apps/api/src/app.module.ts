import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CqrsModule } from '@nestjs/cqrs';
import { dataSourceOptions } from './db/data-source';
import { AppDbContext } from './db/app-db-context';
import { HealthController } from './health/health.controller';
import { createRedis, REDIS } from './redis';

@Module({
  imports: [TypeOrmModule.forRoot(dataSourceOptions), CqrsModule.forRoot()],
  controllers: [HealthController],
  providers: [
    AppDbContext,
    { provide: REDIS, useFactory: createRedis },
  ],
})
export class AppModule {}
