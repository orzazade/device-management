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
import { notify, staffIds } from '../notifications/notify';
import { transition } from './request-machine';

const EXCLUSION_VIOLATION = '23P01';

async function loadRequest(ctx: TransactionalContext, id: string): Promise<DeviceRequest> {
  // Row lock first (no relations — Postgres refuses FOR UPDATE on outer
  // joins), so two concurrent decisions on one request serialize instead
  // of silently overwriting each other.
  const locked = await ctx.requests.findOne({
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  if (!locked) throw new NotFoundException('Request not found');
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

/** A booking that makes the device unavailable for [from, to]:
 * an overdue loan occupies the device until an unknown return date, so it
 * conflicts with ANY range; approved/active bookings conflict by range. */
async function conflictingBooking(
  ctx: TransactionalContext,
  deviceId: string,
  fromDate: string,
  toDate: string,
  excludeId?: string,
): Promise<DeviceRequest | null> {
  const qb = ctx.requests
    .createQueryBuilder('r')
    .where('r.deviceId = :deviceId', { deviceId })
    .andWhere(
      `(r.state = 'overdue' OR (r.state IN ('approved','active') AND daterange(r.from_date, r.to_date, '[]') && daterange(:from, :to, '[]')))`,
      { from: fromDate, to: toDate },
    );
  if (excludeId) qb.andWhere('r.id != :excludeId', { excludeId });
  return qb.getOne();
}

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
      const requesterName =
        (await ctx.users.findOne({ where: { id: data.requesterId } }))?.name ?? 'someone';
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: 'created',
        newValue: {
          device: `${device.brand} ${device.model}`,
          requester: requesterName,
          range: `${data.fromDate} – ${data.toDate}`,
        },
      });
      // Config flag (GOALS.md): 'all' = everything needs approval (launch),
      // 'busy_only' = a free device auto-approves.
      const mode = await ctx.settings.findOne({ where: { key: 'approval_mode' } });
      // Pre-check instead of relying on the constraint: a constraint hit here
      // would roll back the whole transaction and the tester's request would
      // vanish. On conflict the request simply stays pending for staff.
      const busy =
        mode?.value === 'busy_only' &&
        (device.holderId !== null ||
          (await conflictingBooking(ctx, device.id, data.fromDate, data.toDate, request.id)));
      let autoApproved = false;
      if (mode?.value === 'busy_only' && !busy) {
        transition(request, 'approved');
        autoApproved = true;
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
      // The right people hear the right thing: an auto-approved request
      // needs a handover, not an approval decision.
      if (autoApproved) {
        await notify(ctx.manager, 'request_approved', [request.requesterId],
          `Your request for ${device.brand} ${device.model} was auto-approved (${data.fromDate} – ${data.toDate})`,
          { requestId: request.id }, '/requests');
        await notify(ctx.manager, 'handover_pending', await staffIds(ctx.manager),
          `Hand ${device.brand} ${device.model} from the lab desk to ${requesterName}`,
          { requestId: request.id }, '/handovers');
      } else {
        await notify(ctx.manager, 'request_created', await staffIds(ctx.manager),
          `${requesterName} requested ${device.brand} ${device.model} (${data.fromDate} – ${data.toDate})`,
          { requestId: request.id }, '/approvals');
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
    readonly actorRole?: string,
    readonly note?: string,
  ) {}
}

@CommandHandler(DecideRequestCommand)
export class DecideRequestHandler implements ICommandHandler<DecideRequestCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, requestId, decision, actorRole, note }: DecideRequestCommand): Promise<DeviceRequest> {
    return this.db.withTransaction(async (ctx) => {
      const request = await loadRequest(ctx, requestId);
      const selfRequest =
        actor.id === request.requesterId || actor.id === request.createdById;
      let auditAction: string = decision;
      if (decision === 'approved') {
        // Approving your own request: a Manager needs a second pair of
        // eyes; the Admin may, but the audit row says so explicitly.
        if (selfRequest && actorRole !== 'admin') {
          throw new ForbiddenException(
            'You cannot approve your own request — ask another approver',
          );
        }
        if (selfRequest && actorRole === 'admin') auditAction = 'self_approved';
        // Approval is a promise about a physical device — re-check it can
        // still be lent at all.
        const device = request.device;
        if (!device) {
          throw new ConflictException('This device no longer exists — reject the request');
        }
        if (device.status === 'retired' || device.status === 'in_repair') {
          throw new ConflictException(
            `Device is ${device.status.replace('_', ' ')} — it cannot be promised right now`,
          );
        }
      }
      if (decision === 'approved') {
        // The exclusion constraint misses an overdue loan (its range is in
        // the past) — but the device is physically out until it comes back.
        const clash = await conflictingBooking(
          ctx, request.deviceId, request.fromDate, request.toDate, request.id,
        );
        if (clash?.state === 'overdue') {
          throw new ConflictException(
            'This device is overdue with its current holder — check it in before approving new bookings',
          );
        }
      }
      const old = transition(request, decision);
      request.decidedById = actor.id;
      if (decision === 'rejected') request.decisionNote = note?.trim() || null;
      try {
        await ctx.requests.save(request);
      } catch (e) {
        if (isOverlapError(e)) throw overlapError();
        throw e;
      }
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: auditAction,
        oldValue: { state: old },
        newValue: decision === 'rejected' && note ? { state: decision, reason: note } : { state: decision },
      });

      const device = request.device;
      const name = `${device.brand} ${device.model}`;
      if (decision === 'approved') {
        await notify(ctx.manager, 'request_approved', [request.requesterId],
          `Your request for ${name} was approved (${request.fromDate} – ${request.toDate})`,
          { requestId: request.id }, '/requests');
        if (device.holderId) {
          await notify(ctx.manager, 'handover_pending', [device.holderId],
            `Handover needed: give ${name} to ${request.requester?.name ?? 'the requester'}`,
            { requestId: request.id }, '/handovers');
        } else {
          await notify(ctx.manager, 'handover_pending', await staffIds(ctx.manager),
            `Hand ${name} from the lab desk to ${request.requester?.name ?? 'the requester'}`,
            { requestId: request.id }, '/handovers');
        }
      } else {
        await notify(ctx.manager, 'request_rejected', [request.requesterId],
          `Your request for ${name} was rejected${note ? ` — ${note.trim()}` : ''}`,
          { requestId: request.id }, '/requests');
      }
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
      const clash = await conflictingBooking(ctx, request.deviceId, fromDate, toDate, request.id);
      if (clash?.state === 'overdue') {
        throw new ConflictException(
          'This device is overdue with its current holder — check it in before moving bookings onto it',
        );
      }
      const old = `${request.fromDate} – ${request.toDate}`;
      request.fromDate = fromDate;
      request.toDate = toDate;
      // Extending a late loan past today makes it simply active again —
      // without this it stays "overdue" forever, alarms and all.
      const today = new Date().toISOString().slice(0, 10);
      const overdueCleared = request.state === 'overdue' && toDate >= today;
      if (overdueCleared) transition(request, 'active');
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
      if (overdueCleared) {
        await writeAudit(ctx.manager, actor, {
          entityType: 'request',
          entityId: request.id,
          action: 'overdue_cleared',
          oldValue: { state: 'overdue' },
          newValue: { state: 'active', dueDate: toDate },
        });
      }
      // The people living with these dates hear about the change.
      const affected = new Set([request.requesterId]);
      if (request.device?.holderId) affected.add(request.device.holderId);
      affected.delete(actor.id!);
      if (affected.size) {
        await notify(ctx.manager, 'request_time_changed', [...affected],
          `Booking time for ${request.device?.brand} ${request.device?.model} changed: ${old} → ${fromDate} – ${toDate}`,
          { requestId: request.id }, '/requests');
      }
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

      if (device.status === 'retired' || device.status === 'in_repair') {
        throw new ConflictException(
          `Device is ${device.status.replace('_', ' ')} — it cannot be handed over`,
        );
      }
      const old = transition(request, 'active');

      // A device with an open loan is not the desk's to give away — the
      // current loan gets checked in first (Loans page, one click), so
      // every return passes the real check-in flow and is audited as one.
      const previous = await ctx.requests.find({
        where: [
          { deviceId: device.id, state: 'active' },
          { deviceId: device.id, state: 'overdue' },
        ],
      });
      if (previous.some((p) => p.id !== request.id)) {
        throw new ConflictException(
          'This device is still checked out — check the current loan in first (Loans page)',
        );
      }

      const previousHolder = device.holderId;
      const previousHolderName = previousHolder
        ? ((await ctx.users.findOne({ where: { id: previousHolder }, withDeleted: true }))?.name ??
          'unknown')
        : 'lab desk';
      device.holderId = request.requesterId;
      device.status = 'assigned';
      await ctx.devices.save(device);
      await ctx.requests.save(request);
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: 'handover_confirmed',
        oldValue: { state: old, holder: previousHolderName },
        newValue: { state: 'active', holder: request.requester.name },
      });
      await notify(ctx.manager, 'request_approved', [request.requesterId],
        `${device.brand} ${device.model} is now assigned to you — return by ${request.toDate}`,
        { requestId: request.id }, '/requests');
      return request;
    });
  }
}

export class ReturnRequestCommand {
  constructor(
    readonly actor: Actor,
    readonly requestId: string,
    readonly byUserId: string,
    readonly byStaff: boolean,
    readonly data: {
      missingAccessories: string[];
      damaged: boolean;
      damageNote?: string;
    },
  ) {}
}

@CommandHandler(ReturnRequestCommand)
export class ReturnRequestHandler implements ICommandHandler<ReturnRequestCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute(cmd: ReturnRequestCommand): Promise<DeviceRequest> {
    const { actor, requestId, byUserId, byStaff, data } = cmd;
    return this.db.withTransaction(async (ctx) => {
      const request = await loadRequest(ctx, requestId);
      if (request.requesterId !== byUserId && !byStaff) {
        throw new ForbiddenException('Only the holder (or staff) can check in this return');
      }
      const old = transition(request, 'returned');

      const device = request.device;
      device.holderId = null;
      // A device retired while on loan stays retired — a return check-in
      // must never resurrect written-off hardware.
      if (data.damaged) {
        if (device.status !== 'retired') device.status = 'in_repair';
        device.damageNote = data.damageNote?.trim() || 'Damage found at return check-in';
        await ctx.repairs.save({
          deviceId: device.id,
          reportedById: byUserId,
          issue: device.damageNote,
          state: 'in_repair',
        });
      } else if (device.status !== 'retired') {
        device.status = 'available';
      }
      await ctx.devices.save(device);
      await ctx.requests.save(request);
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: 'returned',
        oldValue: { state: old },
        newValue: {
          state: 'returned',
          missingAccessories: data.missingAccessories,
          damaged: data.damaged,
          ...(data.damaged ? { damageNote: device.damageNote } : {}),
        },
      });
      if (data.missingAccessories.length) {
        // Loud: missing accessories get their own audit row on the device.
        await writeAudit(ctx.manager, actor, {
          entityType: 'device',
          entityId: device.id,
          action: 'accessories_missing_at_return',
          newValue: { missing: data.missingAccessories },
        });
      }
      if (data.damaged) {
        await notify(ctx.manager, 'repair_update', await staffIds(ctx.manager),
          `${device.brand} ${device.model} came back damaged: ${device.damageNote}`,
          { deviceId: device.id }, '/repairs');
      }
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
      const name = `${request.device?.brand} ${request.device?.model}`;
      const cancelledBySelf = byUserId === request.requesterId;
      if (cancelledBySelf) {
        // The requester pulled out — staff should stop expecting a handover.
        if (old !== 'pending') {
          const targets = new Set(await staffIds(ctx.manager));
          if (request.device?.holderId) targets.add(request.device.holderId);
          targets.delete(byUserId);
          await notify(ctx.manager, 'request_cancelled', [...targets],
            `${request.requester?.name ?? 'The requester'} cancelled their ${old} request for ${name}`,
            { requestId: request.id }, '/approvals');
        }
      } else {
        await notify(ctx.manager, 'request_cancelled', [request.requesterId],
          `Your request for ${name} was cancelled by ${actor.name}`,
          { requestId: request.id }, '/requests');
      }
      return request;
    });
  }
}
