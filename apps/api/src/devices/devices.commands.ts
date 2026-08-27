import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { In } from 'typeorm';
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
  squadId?: string | null;
}

/** A device must sit in a project or a squad; named ids must exist and be
 * of the right kind. */
async function assertGrouping(
  ctx: { projects: { findOne: (o: object) => Promise<unknown> } },
  projectId: string | null,
  squadId: string | null,
): Promise<void> {
  if (!projectId && !squadId) {
    throw new BadRequestException('Pick a project or a squad for this device');
  }
  if (projectId && !(await ctx.projects.findOne({ where: { id: projectId, kind: 'project' } }))) {
    throw new BadRequestException('That project does not exist');
  }
  if (squadId && !(await ctx.projects.findOne({ where: { id: squadId, kind: 'squad' } }))) {
    throw new BadRequestException('That squad does not exist');
  }
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
      await assertGrouping(ctx, data.projectId ?? null, data.squadId ?? null);
      const device = await ctx.devices.save({
        ...data,
        osVersion: data.osVersion ?? '',
        specs: data.specs ?? {},
        imei: data.imei ?? '',
        accessories: data.accessories ?? [],
        projectId: data.projectId ?? null,
        squadId: data.squadId ?? null,
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
      // Retiring via edit runs the same guards as delete — no stranded loans.
      if (data.status === 'retired' && device.status !== 'retired') {
        if (device.holderId) {
          throw new ConflictException('Device is in someone’s hands — take it back first');
        }
        const open = await ctx.requests.count({
          where: { deviceId: id, state: In(['pending', 'approved', 'active', 'overdue']) },
        });
        if (open > 0) {
          throw new ConflictException(`Device has ${open} open request(s) — resolve them first`);
        }
      }
      // A device may never end up with neither a project nor a squad.
      const finalProject = 'projectId' in data ? (data.projectId ?? null) : device.projectId;
      const finalSquad = 'squadId' in data ? (data.squadId ?? null) : device.squadId;
      await assertGrouping(ctx, finalProject, finalSquad);
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
      // The audit log answers "which project / squad?", not "which UUID?".
      const name = async (pid: unknown) =>
        pid
          ? ((await ctx.projects.findOne({ where: { id: pid as string }, withDeleted: true }))
              ?.name ?? '—')
          : '—';
      if ('projectId' in after) {
        before.project = await name(before.projectId);
        after.project = await name(after.projectId);
        delete before.projectId;
        delete after.projectId;
      }
      if ('squadId' in after) {
        before.squad = await name(before.squadId);
        after.squad = await name(after.squadId);
        delete before.squadId;
        delete after.squadId;
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
