import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { IDENTITY_PROVIDER } from './auth/identity-provider';
import { LocalIdentityProvider } from './auth/local-identity.provider';
import { AuditController } from './audit/audit.controller';
import { config } from './config';
import { AppDbContext } from './db/app-db-context';
import { dataSourceOptions } from './db/data-source';
import { HealthController } from './health/health.controller';
import { createRedis, REDIS } from './redis';
import { ChangeUserRoleHandler, CreateUserHandler } from './users/users.commands';
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
  controllers: [HealthController, AuthController, UsersController, AuditController],
  providers: [
    AppDbContext,
    { provide: REDIS, useFactory: createRedis },
    { provide: IDENTITY_PROVIDER, useClass: LocalIdentityProvider },
    { provide: APP_GUARD, useClass: AuthGuard },
    CreateUserHandler,
    ChangeUserRoleHandler,
  ],
})
export class AppModule {}
