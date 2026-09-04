import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { PermissionResolver } from './auth/permission.resolver';
import { RolesController } from './auth/roles.controller';
import { IDENTITY_PROVIDER } from './auth/identity-provider';
import { LocalIdentityProvider } from './auth/local-identity.provider';
import { AuditController } from './audit/audit.controller';
import { config } from './config';
import { AppDbContext } from './db/app-db-context';
import { dataSourceOptions } from './db/data-source';
import { HealthController } from './health/health.controller';
import { createRedis, REDIS } from './redis';
import { CreateDeviceHandler, UpdateDeviceHandler } from './devices/devices.commands';
import { DevicesController } from './devices/devices.controller';
import { ImportService } from './devices/import.service';
import { JobsService } from './jobs/jobs.service';
import { NotificationsController } from './notifications/notifications.controller';
import { RepairsController } from './repairs/repairs.controller';
import { ReportsController } from './reports/reports.controller';
import { ProjectsController } from './projects/projects.controller';
import {
  CancelRequestHandler,
  CreateRequestHandler,
  DecideRequestHandler,
  OverrideTimeHandler,
  ReturnRequestHandler,
} from './requests/requests.commands';
import { RequestsController } from './requests/requests.controller';
import {
  ChangeUserRoleHandler,
  CreateUserHandler,
  UpdateUserHandler,
} from './users/users.commands';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot(dataSourceOptions),
    CqrsModule.forRoot(),
    JwtModule.register({
      global: true,
      secret: config.jwtSecret,
      signOptions: { expiresIn: config.jwtTtl as `${number}h` },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    RolesController,
    AuditController,
    DevicesController,
    ProjectsController,
    RequestsController,
    NotificationsController,
    RepairsController,
    ReportsController,
  ],
  providers: [
    PermissionResolver,
    AppDbContext,
    { provide: REDIS, useFactory: createRedis },
    { provide: IDENTITY_PROVIDER, useClass: LocalIdentityProvider },
    { provide: APP_GUARD, useClass: AuthGuard },
    CreateUserHandler,
    ChangeUserRoleHandler,
    UpdateUserHandler,
    CreateDeviceHandler,
    UpdateDeviceHandler,
    ImportService,
    CreateRequestHandler,
    DecideRequestHandler,
    OverrideTimeHandler,
      CancelRequestHandler,
    ReturnRequestHandler,
    JobsService,
  ],
})
export class AppModule {}
