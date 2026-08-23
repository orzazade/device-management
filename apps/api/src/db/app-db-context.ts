import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppSetting } from '../entities/app-setting.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { User } from '../entities/user.entity';

/**
 * EF Core–style DbContext: one injectable that owns every repository.
 * Handlers depend on this, never on scattered @InjectRepository.
 *
 * Writes in command handlers go through withTransaction() so state change +
 * audit row + outbox rows commit atomically — the discipline that replaces
 * EF's SaveChanges.
 */
@Injectable()
export class AppDbContext {
  constructor(private readonly dataSource: DataSource) {}

  private m(manager?: EntityManager): EntityManager {
    return manager ?? this.dataSource.manager;
  }

  settings(manager?: EntityManager): Repository<AppSetting> {
    return this.m(manager).getRepository(AppSetting);
  }

  users(manager?: EntityManager): Repository<User> {
    return this.m(manager).getRepository(User);
  }

  auditLogs(manager?: EntityManager): Repository<AuditLog> {
    return this.m(manager).getRepository(AuditLog);
  }

  withTransaction<T>(fn: (ctx: TransactionalContext) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      return fn(new TransactionalContext(manager));
    });
  }

  get raw(): DataSource {
    return this.dataSource;
  }
}

/** The same repository surface, bound to one open transaction. */
export class TransactionalContext {
  constructor(readonly manager: EntityManager) {}

  get settings(): Repository<AppSetting> {
    return this.manager.getRepository(AppSetting);
  }

  get users(): Repository<User> {
    return this.manager.getRepository(User);
  }

  get auditLogs(): Repository<AuditLog> {
    return this.manager.getRepository(AuditLog);
  }
}
