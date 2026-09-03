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
import { localDay } from '../dates';

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

/** Hand the device to the requester, right now.
 *
 * This is the moment the lab actually cares about: the phone stops being
 * whoever's it was and becomes the requester's. It happens the instant a
 * request is granted — either because nobody held the device and the
 * requester simply took it, or because the person holding it said yes.
 * There is no separate "confirm handover" step: approval *is* the handover.
 *
 * A device can only be in one pair of hands, so the previous holder's loan is
 * closed as part of the same transaction and audited as a transfer, never
 * left dangling.
 */
async function assignDevice(
  ctx: TransactionalContext,
  actor: Actor,
  request: DeviceRequest,
  auditAction: string,
): Promise<void> {
  const device = request.device;
  if (device.status === 'retired' || device.status === 'in_repair') {
    throw new ConflictException(
      `Device is ${device.status.replace('_', ' ')} — it cannot be handed over`,
    );
  }
  const previousHolderId = device.holderId;
  const previousHolderName = previousHolderId
    ? ((await ctx.users.findOne({ where: { id: previousHolderId }, withDeleted: true }))?.name ??
      'unknown')
    : 'the shelf';

  // Close whatever loan the device was on. Without this the device would
  // carry two open loans and the "one open loan" index would reject the save.
  const open = await ctx.requests.find({
    where: [
      { deviceId: device.id, state: 'active' },
      { deviceId: device.id, state: 'overdue' },
    ],
  });
  for (const loan of open) {
    if (loan.id === request.id) continue;
    const was = transition(loan, 'returned');
    await ctx.requests.save(loan);
    await writeAudit(ctx.manager, actor, {
      entityType: 'request',
      entityId: loan.id,
      action: 'transferred',
      oldValue: { state: was, holder: previousHolderName },
      newValue: { state: 'returned', holder: request.requester?.name ?? 'the requester' },
    });
  }

  const old = transition(request, 'active');
  device.holderId = request.requesterId;
  device.status = 'assigned';
  await ctx.devices.save(device);
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
    oldValue: { state: old, holder: previousHolderName },
    newValue: { state: 'active', holder: request.requester?.name ?? 'the requester' },
  });
  const name = `${device.brand} ${device.model}`;
  await notify(ctx.manager, 'request_approved', [request.requesterId],
    `${name} is now assigned to you — return by ${request.toDate}`,
    { requestId: request.id }, '/requests');
  if (previousHolderId && previousHolderId !== request.requesterId) {
    await notify(ctx.manager, 'request_approved', [previousHolderId],
      `${name} has moved from you to ${request.requester?.name ?? 'the requester'}`,
      { requestId: request.id }, '/requests');
  }
}

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
      projectId: string;
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
      const days =
        (Date.parse(data.toDate) - Date.parse(data.fromDate)) / 86400000 + 1;
      if (days > 60) {
        throw new BadRequestException(
          'Bookings are capped at 60 days — split longer needs or talk to a manager',
        );
      }

            const project = await ctx.projects.findOne({ where: { id: data.projectId, kind: 'project' } });
      if (!project) throw new BadRequestException('Pick a project that exists');
      const request = await ctx.requests.save({
        deviceId: data.deviceId,
        requesterId: data.requesterId,
        createdById: actor.id!,
        projectId: data.projectId,
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
          reason: data.reason,
        },
      });
      // The whole process, in one place:
      //
      //   nobody is holding it   -> the requester just takes it
      //   somebody is holding it -> that person decides, nobody else
      //
      // A free device whose dates clash with an existing booking is the one
      // case with no obvious answer — there is no holder to ask — so it waits
      // for the Admin.
      const heldBy = device.holderId;
      const clash = heldBy
        ? null
        : await conflictingBooking(ctx, device.id, data.fromDate, data.toDate, request.id);
      const startsToday = data.fromDate <= localDay();

      if (!heldBy && !clash) {
        if (startsToday) {
          // Straight into their hands — no approval step exists for a phone
          // nobody is using.
          // assignDevice saves the row it is handed, so it gets the real
          // request with its relations attached — not a copy.
          request.device = device;
          request.requester = { name: requesterName } as DeviceRequest['requester'];
          await assignDevice(ctx, actor, request, 'taken');
        } else {
          // Booked ahead: granted now, assigned on the morning it starts.
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
            newValue: { state: 'approved', starts: data.fromDate },
          });
          await notify(ctx.manager, 'request_approved', [request.requesterId],
            `${device.brand} ${device.model} is booked for you from ${data.fromDate} — it becomes yours that morning`,
            { requestId: request.id }, '/requests');
        }
      } else if (heldBy) {
        // Peer approval: the person actually holding the phone is the one
        // being asked to give it up, so they are the one who hears about it.
        await notify(ctx.manager, 'request_created', [heldBy],
          `${requesterName} is asking for ${device.brand} ${device.model} you are holding (${data.fromDate} – ${data.toDate}) — approve or reject it`,
          { requestId: request.id }, '/requests');
      } else {
        await notify(ctx.manager, 'request_created', await staffIds(ctx.manager),
          `${requesterName} requested ${device.brand} ${device.model} (${data.fromDate} – ${data.toDate}) — the dates clash with an existing booking`,
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

      // Who is allowed to decide at all. The person holding the device does,
      // because they are the one being asked to give it up. The Admin can too
      // — somebody has to be able to unstick a request whose holder has left
      // the company — but an Admin overriding a peer is recorded as exactly
      // that, not disguised as the holder's own decision.
      const holderId = request.device?.holderId ?? null;
      const isAdmin = actorRole === 'admin';
      const isHolder = holderId !== null && actor.id === holderId;
      if (!isHolder && !isAdmin) {
        throw new ForbiddenException(
          holderId
            ? 'Only the person holding this device can decide this request'
            : 'Only an Admin can decide this request',
        );
      }
      const adminOverride = isAdmin && !isHolder && holderId !== null;
      if (decision === 'approved') {
        // Approving your own request: only the Admin may, and the audit row
        // says so explicitly rather than reading like an ordinary approval.
        if (selfRequest && !isAdmin) {
          throw new ForbiddenException(
            'You cannot approve your own request — ask another approver',
          );
        }
        if (selfRequest && isAdmin) auditAction = 'self_approved';
        else if (adminOverride) auditAction = 'admin_override_approved';
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
        const found = await conflictingBooking(
          ctx, request.deviceId, request.fromDate, request.toDate, request.id,
        );
        // The holder's own loan is not a clash — it is the thing being ended.
        // Approving a transfer hands the device on and closes that loan in the
        // same breath, so counting it here would make every transfer
        // impossible. Anyone else's booking still blocks.
        //
        // With one limit: only the holder may pass on a device that is
        // OVERDUE. They have it in their hands, so they can vouch for where
        // it is. An Admin overriding from the desk cannot — a late device is
        // unaccounted for until somebody physically checks it in, and
        // "transferring" it on paper would quietly close a loan nobody has
        // confirmed the end of.
        const ownLoan =
          !!found &&
          (found.state === 'active' || found.state === 'overdue') &&
          holderId !== null &&
          found.requesterId === holderId;
        const isTheLoanBeingEnded = ownLoan && (found.state !== 'overdue' || isHolder);
        const clash = isTheLoanBeingEnded ? null : found;
        if (clash && clash.state !== 'overdue') {
          throw new ConflictException(
            `This clashes with an existing ${clash.state} booking (${clash.fromDate} – ${clash.toDate})`,
          );
        }
        if (clash?.state === 'overdue') {
          throw new ConflictException(
            'This device is overdue with its current holder — check it in before approving new bookings',
          );
        }
      }
      const device = request.device;
      const name = `${device.brand} ${device.model}`;
      request.decidedById = actor.id;

      if (decision === 'approved') {
        // Approval IS the handover. A booking that starts today changes hands
        // now; one booked for a later date is promised now and assigned on
        // the morning it starts.
        if (request.fromDate <= localDay()) {
          await assignDevice(ctx, actor, request, auditAction);
          return request;
        }
        const old = transition(request, 'approved');
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
          newValue: { state: 'approved', starts: request.fromDate },
        });
        await notify(ctx.manager, 'request_approved', [request.requesterId],
          `Your request for ${name} was approved — it becomes yours on ${request.fromDate}`,
          { requestId: request.id }, '/requests');
        return request;
      }

      const old = transition(request, decision);
      request.decisionNote = note?.trim() || null;
      await ctx.requests.save(request);
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: auditAction,
        oldValue: { state: old },
        newValue: note ? { state: decision, reason: note } : { state: decision },
      });
      await notify(ctx.manager, 'request_rejected', [request.requesterId],
        `Your request for ${name} was rejected${note ? ` — ${note.trim()}` : ''}`,
        { requestId: request.id }, '/requests');
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
      const today = localDay();
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
      // The receipt principle: a device is returned when someone at the
      // desk RECEIVES it — mirroring handover. Testers signal intent via
      // return-intent; staff record the actual check-in.
      if (!byStaff) {
        throw new ForbiddenException(
          'Bring the device to the desk — a manager checks it in (you can notify them from My requests)',
        );
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
    /** Required when someone other than the requester cancels. */
    readonly note?: string,
  ) {}
}

@CommandHandler(CancelRequestCommand)
export class CancelRequestHandler implements ICommandHandler<CancelRequestCommand> {
  constructor(private readonly db: AppDbContext) {}

  async execute({ actor, requestId, byUserId, byStaff, note }: CancelRequestCommand): Promise<DeviceRequest> {
    return this.db.withTransaction(async (ctx) => {
      const request = await loadRequest(ctx, requestId);
      const isOwner = request.requesterId === byUserId || request.createdById === byUserId;
      // The person holding the device may refuse an approved handover.
      const isHolder =
        request.state === 'approved' && !!request.device?.holderId && request.device.holderId === byUserId;
      if (!isOwner && !isHolder && !byStaff) {
        throw new ForbiddenException('Only the requester, the current holder or staff can cancel this request');
      }
      const reason = (note ?? '').trim();
      if (!isOwner && reason.length < 5) {
        throw new BadRequestException('Give the requester a reason (at least 5 characters)');
      }
      const old = transition(request, 'cancelled');
      if (reason) request.decisionNote = reason;
      await ctx.requests.save(request);
      await writeAudit(ctx.manager, actor, {
        entityType: 'request',
        entityId: request.id,
        action: 'cancelled',
        oldValue: { state: old },
        newValue: { state: 'cancelled', ...(reason ? { note: reason } : {}) },
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
            { requestId: request.id }, '/requests');
        }
      } else {
        await notify(ctx.manager, 'request_cancelled', [request.requesterId],
          `Your request for ${name} was cancelled by ${actor.name}: ${reason}`,
          { requestId: request.id }, '/requests');
      }
      return request;
    });
  }
}
