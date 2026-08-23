import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Actor, writeAudit } from '../audit/audit';
import { AppDbContext, TransactionalContext } from '../db/app-db-context';
import { DeviceRequest } from '../entities/device-request.entity';
import { transition } from './request-machine';

const EXCLUSION_VIOLATION = '23P01';

async function loadRequest(ctx: TransactionalContext, id: string): Promise<DeviceRequest> {
  const request = await ctx.requests.findOne({
    where: { id },
    relations: { device: true, requester: true },
  });
  if (!request) throw new NotFoundException('Request not found');
  return request;
}

function isOverlapError(e: unknown): boolean {
  return (e as { driverError?: { code?: string } })?.driverError?.code === EXCLUSION_VIOLATION;
}

const overlapError = () =>
  new ConflictException(
    'This device already has an approved booking that overlaps this time range',
  );

export class CreateRequestCommand {
  constructor(
    readonly actor: Actor,
    readonly data: {
      deviceId: string;
      requesterId: string;
      reason: string;
      fromDate: string;
      toDate: string;
    },
  ) {}
}

@CommandHandler(CreateRequestCommand)
export class CreateRequestHandler implements ICommandHandler<CreateRequestCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, data }: CreateRequestCommand): Promise<DeviceRequest> {
    return this.db.withTransaction(async (ctx) => {
      const device = await ctx.devices.findOne({ where: { id: data.deviceId } });
      if (!device) throw new NotFoundException('Device not found');
      if (device.status === 'retired' || device.status === 'in_repair') {
        throw new BadRequestException(`Device is ${device.status.replace('_', ' ')} — it cannot be requested`);
      }
      if (data.fromDate > data.toDate) {
        throw new BadRequestException('The "from" date must not be after the "to" date');
      }

      const request = await ctx.requests.save({
        deviceId: data.deviceId,
        requesterId: data.requesterId,
        createdById: actor.id!,
        reason: data.reason,
        fromDate: data.fromDate,
        toDate: data.toDate,
        state: 'pending',
      });
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: 'created',
        newValue: {
          device: `${device.brand} ${device.model}`,
          requesterId: data.requesterId,
          range: `${data.fromDate} – ${data.toDate}`,
        },
      });

      // Config flag (GOALS.md): 'all' = everything needs approval (launch),
      // 'busy_only' = a free device auto-approves.
      const mode = await ctx.settings.findOne({ where: { key: 'approval_mode' } });
      if (mode?.value === 'busy_only' && device.holderId === null) {
        transition(request, 'approved');
        try {
          await ctx.requests.save(request);
        } catch (e) {
          if (isOverlapError(e)) throw overlapError();
          throw e;
        }
        await writeAudit(ctx.manager, actor, {
          entityType: 'request',
          entityId: request.id,
          action: 'auto_approved',
          oldValue: { state: 'pending' },
          newValue: { state: 'approved' },
        });
      }
      return request;
    });
  }
}

export class DecideRequestCommand {
  constructor(
    readonly actor: Actor,
    readonly requestId: string,
    readonly decision: 'approved' | 'rejected',
  ) {}
}

@CommandHandler(DecideRequestCommand)
export class DecideRequestHandler implements ICommandHandler<DecideRequestCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, requestId, decision }: DecideRequestCommand): Promise<DeviceRequest> {
    return this.db.withTransaction(async (ctx) => {
      const request = await loadRequest(ctx, requestId);
      const old = transition(request, decision);
      request.decidedById = actor.id;
      try {
        await ctx.requests.save(request);
      } catch (e) {
        if (isOverlapError(e)) throw overlapError();
        throw e;
      }
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: decision,
        oldValue: { state: old },
        newValue: { state: decision },
      });
      return request;
    });
  }
}

export class OverrideTimeCommand {
  constructor(
    readonly actor: Actor,
    readonly requestId: string,
    readonly fromDate: string,
    readonly toDate: string,
  ) {}
}

@CommandHandler(OverrideTimeCommand)
export class OverrideTimeHandler implements ICommandHandler<OverrideTimeCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, requestId, fromDate, toDate }: OverrideTimeCommand): Promise<DeviceRequest> {
    return this.db.withTransaction(async (ctx) => {
      const request = await loadRequest(ctx, requestId);
      if (!['pending', 'approved', 'active', 'overdue'].includes(request.state)) {
        throw new ConflictException(`Cannot change time on a ${request.state} request`);
      }
      if (fromDate > toDate) {
        throw new BadRequestException('The "from" date must not be after the "to" date');
      }
      const old = `${request.fromDate} – ${request.toDate}`;
      request.fromDate = fromDate;
      request.toDate = toDate;
      try {
        await ctx.requests.save(request);
      } catch (e) {
        if (isOverlapError(e)) throw overlapError();
        throw e;
      }
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: 'time_override',
        oldValue: { range: old },
        newValue: { range: `${fromDate} – ${toDate}` },
      });
      return request;
    });
  }
}

export class ConfirmHandoverCommand {
  constructor(
    readonly actor: Actor,
    readonly requestId: string,
    /** The confirmer: must be the device's current holder, or staff when the device is on the lab desk. */
    readonly confirmerId: string,
    readonly confirmerIsStaff: boolean,
  ) {}
}

@CommandHandler(ConfirmHandoverCommand)
export class ConfirmHandoverHandler implements ICommandHandler<ConfirmHandoverCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute(cmd: ConfirmHandoverCommand): Promise<DeviceRequest> {
    const { actor, requestId, confirmerId, confirmerIsStaff } = cmd;
    return this.db.withTransaction(async (ctx) => {
      const request = await loadRequest(ctx, requestId);
      const device = request.device;

      const holderConfirms = device.holderId !== null && device.holderId === confirmerId;
      const deskConfirms = device.holderId === null && confirmerIsStaff;
      if (!holderConfirms && !deskConfirms) {
        throw new ForbiddenException(
          device.holderId
            ? 'Only the current holder can confirm this handover'
            : 'Only a manager or admin can hand over from the lab desk',
        );
      }

      const old = transition(request, 'active');

      // Whatever the previous holder still had running on this device is over.
      const previous = await ctx.requests.find({
        where: [
          { deviceId: device.id, state: 'active' },
          { deviceId: device.id, state: 'overdue' },
        ],
      });
      for (const p of previous) {
        const pOld = transition(p, 'returned');
        await ctx.requests.save(p);
        await writeAudit(ctx.manager, actor, {
          entityType: 'request',
          entityId: p.id,
          action: 'closed_by_handover',
          oldValue: { state: pOld },
          newValue: { state: 'returned' },
        });
      }

      const previousHolder = device.holderId;
      device.holderId = request.requesterId;
      device.status = 'assigned';
      await ctx.devices.save(device);
      await ctx.requests.save(request);
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: 'handover_confirmed',
        oldValue: { state: old, holderId: previousHolder },
        newValue: { state: 'active', holderId: request.requesterId },
      });
      return request;
    });
  }
}

export class CancelRequestCommand {
  constructor(
    readonly actor: Actor,
    readonly requestId: string,
    readonly byUserId: string,
    readonly byStaff: boolean,
  ) {}
}

@CommandHandler(CancelRequestCommand)
export class CancelRequestHandler implements ICommandHandler<CancelRequestCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, requestId, byUserId, byStaff }: CancelRequestCommand): Promise<DeviceRequest> {
    return this.db.withTransaction(async (ctx) => {
      const request = await loadRequest(ctx, requestId);
      if (request.requesterId !== byUserId && request.createdById !== byUserId && !byStaff) {
        throw new ForbiddenException('Only the requester (or staff) can cancel this request');
      }
      const old = transition(request, 'cancelled');
      await ctx.requests.save(request);
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: 'cancelled',
        oldValue: { state: old },
        newValue: { state: 'cancelled' },
      });
      return request;
    });
  }
}
