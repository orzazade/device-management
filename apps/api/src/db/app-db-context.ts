import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
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

  devices(manager?: EntityManager): Repository<Device> {
    return this.m(manager).getRepository(Device);
  }

  projects(manager?: EntityManager): Repository<Project> {
    return this.m(manager).getRepository(Project);
  }

  requests(manager?: EntityManager): Repository<DeviceRequest> {
    return this.m(manager).getRepository(DeviceRequest);
  }

  notifications(manager?: EntityManager): Repository<Notification> {
    return this.m(manager).getRepository(Notification);
  }

  notificationRules(manager?: EntityManager): Repository<NotificationRule> {
    return this.m(manager).getRepository(NotificationRule);
  }

  emailOutbox(manager?: EntityManager): Repository<EmailOutbox> {
    return this.m(manager).getRepository(EmailOutbox);
  }

  repairs(manager?: EntityManager): Repository<Repair> {
    return this.m(manager).getRepository(Repair);
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

  get devices(): Repository<Device> {
    return this.manager.getRepository(Device);
  }

  get projects(): Repository<Project> {
    return this.manager.getRepository(Project);
  }

  get requests(): Repository<DeviceRequest> {
    return this.manager.getRepository(DeviceRequest);
  }

  get repairs(): Repository<Repair> {
    return this.manager.getRepository(Repair);
  }
}
