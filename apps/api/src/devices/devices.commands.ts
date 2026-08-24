import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Actor, writeAudit } from '../audit/audit';
import { AppDbContext } from '../db/app-db-context';
import { Device } from '../entities/device.entity';

export interface DeviceInput {
  brand: string;
  model: string;
  os: string;
  osVersion?: string;
  specs?: Record<string, unknown>;
  serial: string;
  imei?: string;
  accessories?: string[];
  projectId?: string | null;
}

export class CreateDeviceCommand {
  constructor(
    readonly actor: Actor,
    readonly data: DeviceInput,
  ) {}
}

@CommandHandler(CreateDeviceCommand)
export class CreateDeviceHandler implements ICommandHandler<CreateDeviceCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, data }: CreateDeviceCommand): Promise<Device> {
    return this.db.withTransaction(async (ctx) => {
      const dup = await ctx.devices.findOne({
        where: { serial: data.serial },
        withDeleted: true,
      });
      if (dup) {
        throw new ConflictException(
          dup.deletedAt
            ? `Serial ${data.serial} belongs to a deleted device — restore it instead`
            : `Serial ${data.serial} already exists`,
        );
      }
      const device = await ctx.devices.save({
        ...data,
        osVersion: data.osVersion ?? '',
        specs: data.specs ?? {},
        imei: data.imei ?? '',
        accessories: data.accessories ?? [],
        projectId: data.projectId ?? null,
      });
      await writeAudit(ctx.manager, actor, {
        entityType: 'device',
        entityId: device.id,
        action: 'created',
        newValue: { brand: device.brand, model: device.model, serial: device.serial },
      });
      return device;
    });
  }
}

export class UpdateDeviceCommand {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly data: Partial<DeviceInput> & { damageNote?: string | null; status?: string },
  ) {}
}

@CommandHandler(UpdateDeviceCommand)
export class UpdateDeviceHandler implements ICommandHandler<UpdateDeviceCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, id, data }: UpdateDeviceCommand): Promise<Device> {
    return this.db.withTransaction(async (ctx) => {
      const device = await ctx.devices.findOne({ where: { id } });
      if (!device) throw new NotFoundException('Device not found');
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        const key = k as keyof Device;
        if (v !== undefined && JSON.stringify(device[key]) !== JSON.stringify(v)) {
          before[k] = device[key];
          after[k] = v;
          (device as any)[k] = v;
        }
      }
      if (Object.keys(after).length === 0) return device;
      await ctx.devices.save(device);
      // The audit log answers "which project?", not "which UUID?".
      if ('projectId' in after) {
        const name = async (pid: unknown) =>
          pid
            ? ((await ctx.projects.findOne({ where: { id: pid as string }, withDeleted: true }))
                ?.name ?? '—')
            : '—';
        before.project = await name(before.projectId);
        after.project = await name(after.projectId);
        delete before.projectId;
        delete after.projectId;
      }
      await writeAudit(ctx.manager, actor, {
        entityType: 'device',
        entityId: device.id,
        action: 'updated',
        oldValue: before,
        newValue: after,
      });
      return device;
    });
  }
}
