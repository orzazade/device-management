import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { EntityManager } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { config } from '../config';
import { AppDbContext } from '../db/app-db-context';
import { DeviceRequest } from '../entities/device-request.entity';
import { EmailOutbox } from '../entities/notification.entity';
import { writeAudit } from '../audit/audit';
import { notify, staffIds } from '../notifications/notify';
import { localDay, localDayOffset } from '../dates';

const SYSTEM_ACTOR = { id: null, name: 'system' };
export const SCHEDULER_QUEUE = 'scheduler';

function redisConnection() {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    // BullMQ requirement — it manages retries itself.
    maxRetriesPerRequest: null as null,
  };
}

/**
 * BullMQ repeatable jobs (ARCH.md): re-registered on every boot, so Redis
 * stays disposable — all truth lives in Postgres. Three jobs:
 * overdue-scan (hourly), due-soon-scan (daily 08:00), email-outbox (minutely).
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('jobs');
  private queue?: Queue;
  private worker?: Worker;
  private smtpWarned = false;

  constructor(private readonly db: AppDbContext) {}

  async onModuleInit() {
    this.queue = new Queue(SCHEDULER_QUEUE, { connection: redisConnection() });
    const tz = process.env.TZ_APP ?? 'Asia/Baku'; // the team works UTC+4
    await this.queue.upsertJobScheduler('overdue-scan', { pattern: '0 * * * *', tz });
    await this.queue.upsertJobScheduler('due-soon-scan', { pattern: '0 8 * * *', tz });
    await this.queue.upsertJobScheduler('email-outbox', { pattern: '* * * * *' });
    this.worker = new Worker(
      SCHEDULER_QUEUE,
      async (job) => {
        if (job.name === 'overdue-scan') {
          await this.activateDueBookings();
          await this.scanOverdue();
          await this.expireStaleApprovals();
        }
        if (job.name === 'due-soon-scan') {
          await this.scanDueSoon();
          await this.renagOverdue();
        }
        if (job.name === 'email-outbox') await this.drainOutbox();
      },
      { connection: redisConnection() },
    );
    this.worker.on('failed', (job, err) =>
      this.log.error(`job ${job?.name} failed: ${err.message}`),
    );
    // Run once on boot too — a restart must not delay overdue detection.
    await this.queue.add('overdue-scan', {});
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }


  /** Everyone an overdue device is a problem for.
   *
   * The holder, who can end it. The Admins, who own the inventory and have
   * to chase it. And anyone with a request queued on that device, because
   * their phone is the one that is not coming. Waiting people were the ones
   * previously left in the dark: they are blocked by the lateness and were
   * never told why.
   */
  private async overdueAudience(
    manager: EntityManager,
    r: DeviceRequest,
  ): Promise<string[]> {
    const others = new Set(await staffIds(manager));
    const queued = await this.db
      .requests()
      .createQueryBuilder('q')
      .where('q.device_id = :d', { d: r.deviceId })
      .andWhere(`q.state IN ('pending', 'approved')`)
      .getMany();
    for (const q of queued) others.add(q.requesterId);
    others.delete(r.requesterId);
    return [...others];
  }

  /** Hands over every booking whose start date has arrived.
   *
   * Approval is normally the handover, but a booking made for a later date
   * has to wait for that date to come round. This is what makes it arrive:
   * on the morning a booking starts, the device becomes the requester's
   * without anyone having to click anything.
   *
   * A device still out with someone else is skipped, not forced — the
   * booking stays approved and `expireStaleApprovals` cleans it up if it
   * never becomes possible.
   */
  async activateDueBookings(): Promise<number> {
    const today = localDay();
    const due = await this.db
      .requests()
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.device', 'device')
      .leftJoinAndSelect('r.requester', 'requester')
      .where(`r.state = 'approved'`)
      .andWhere('r.fromDate <= :today', { today })
      .getMany();
    let n = 0;
    for (const r of due) {
      const blocked = await this.db
        .requests()
        .createQueryBuilder('o')
        .where('o.device_id = :d', { d: r.deviceId })
        .andWhere(`o.state IN ('active', 'overdue')`)
        .andWhere('o.id != :id', { id: r.id })
        .getOne();
      if (blocked) continue;
      await this.db.withTransaction(async (ctx) => {
        const res = await ctx.requests
          .createQueryBuilder()
          .update()
          .set({ state: 'active' })
          .where(`id = :id AND state = 'approved'`, { id: r.id })
          .execute();
        if (!res.affected) return;
        n++;
        const device = r.device;
        device.holderId = r.requesterId;
        device.status = 'assigned';
        await ctx.devices.save(device);
        await writeAudit(ctx.manager, SYSTEM_ACTOR, {
          entityType: 'request',
          entityId: r.id,
          action: 'booking_started',
          oldValue: { state: 'approved' },
          newValue: { state: 'active', holder: r.requester?.name ?? 'the requester' },
        });
        await notify(ctx.manager, 'request_approved', [r.requesterId],
          `${device.brand} ${device.model} is yours from today — return by ${r.toDate}`,
          { requestId: r.id }, '/requests');
      });
    }
    if (n) this.log.log(`activated ${n} booking(s) starting today`);
    return n;
  }

  /** Approved but never collected: after 2 days past the start date the
   * promise expires, freeing the device's calendar. */
  async expireStaleApprovals(): Promise<number> {
    const cutoff = localDayOffset(-2);
    const stale = await this.db
      .requests()
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.device', 'device')
      .where(`r.state = 'approved'`)
      .andWhere('r.fromDate < :cutoff', { cutoff })
      .getMany();
    let n = 0;
    for (const r of stale) {
      await this.db.withTransaction(async (ctx) => {
        const res = await ctx.requests
          .createQueryBuilder()
          .update()
          .set({ state: 'cancelled' })
          .where(`id = :id AND state = 'approved'`, { id: r.id })
          .execute();
        if (!res.affected) return;
        n++;
        await writeAudit(ctx.manager, SYSTEM_ACTOR, {
          entityType: 'request',
          entityId: r.id,
          action: 'expired',
          oldValue: { state: 'approved' },
          newValue: { state: 'cancelled', reason: 'never collected within 2 days of start date' },
        });
        await notify(ctx.manager, 'request_cancelled', [r.requesterId],
          `Your approved booking for ${r.device.brand} ${r.device.model} expired — it was never collected. Request again if you still need it.`,
          { requestId: r.id }, '/requests');
      });
    }
    return n;
  }

  /** Marks active requests past their to-date as overdue. Returns count. */
  async scanOverdue(byActor?: { id: string | null; name: string }): Promise<number> {
    const today = localDay();
    const late = await this.db
      .requests()
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.device', 'device')
      .leftJoinAndSelect('r.requester', 'requester')
      .where('r.state = :s', { s: 'active' })
      .andWhere('r.toDate < :today', { today })
      .getMany();
    for (const r of late) {
      await this.db.withTransaction(async (ctx) => {
        // Guarded UPDATE: if a return won the race since our SELECT, we
        // touch nothing and send nothing.
        const res = await ctx.requests
          .createQueryBuilder()
          .update()
          .set({ state: 'overdue' })
          .where(`id = :id AND state = 'active'`, { id: r.id })
          .execute();
        if (!res.affected) return;
        const old = 'active';
        r.state = 'overdue';
        await writeAudit(ctx.manager, byActor ?? SYSTEM_ACTOR, {
          entityType: 'request',
          entityId: r.id,
          action: 'marked_overdue',
          oldValue: { state: old },
          newValue: { state: 'overdue', dueDate: r.toDate },
        });
        const name = `${r.device.brand} ${r.device.model}`;
        await notify(ctx.manager, 'overdue', [r.requesterId],
          `${name} is overdue — it was due back ${r.toDate}. Return it, or extend the loan if you still need it`,
          { requestId: r.id }, '/requests');
        const others = await this.overdueAudience(ctx.manager, r);
        await notify(ctx.manager, 'overdue', others,
          `${name} is overdue with ${r.requester?.name ?? 'its holder'} (due ${r.toDate})`,
          { requestId: r.id }, '/loans');
      });
    }
    if (late.length) this.log.warn(`overdue scan: ${late.length} request(s) marked overdue`);
    return late.length;
  }

  /** Still-overdue loans get a repeat nag every 3 days — one overdue
   * notification at flip time is easy to scroll past. */
  async renagOverdue(): Promise<number> {
    const overdue = await this.db
      .requests()
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.device', 'device')
      .leftJoinAndSelect('r.requester', 'requester')
      .where(`r.state = 'overdue'`)
      .getMany();
    let sent = 0;
    for (const r of overdue) {
      const recent = await this.db
        .notifications()
        .createQueryBuilder('n')
        .where(`n.event = 'overdue'`)
        .andWhere(`n.meta->>'requestId' = :id`, { id: r.id })
        .andWhere(`n.createdAt > now() - interval '3 days'`)
        .getOne();
      if (recent) continue;
      await this.db.withTransaction(async (ctx) => {
        const name = `${r.device.brand} ${r.device.model}`;
        // The holder is told what they can do about it: bringing the device
        // back is the fix, but a loan that is simply still needed can be
        // extended instead — the button is on their own row.
        await notify(ctx.manager, 'overdue', [r.requesterId],
          `${name} is STILL overdue — it was due back ${r.toDate}. Return it, or extend the loan if you still need it`,
          { requestId: r.id }, '/requests');
        // The desk hears about it every time too, not just when it first
        // went late: the longer a device is out, the more the people who
        // own the inventory need to know.
        const others = await this.overdueAudience(ctx.manager, r);
        await notify(ctx.manager, 'overdue', others,
          `${name} is still overdue with ${r.requester?.name ?? 'its holder'} (due ${r.toDate})`,
          { requestId: r.id }, '/loans');
      });
      sent++;
    }
    return sent;
  }

  /** Reminds holders the day before a return is due. De-duped per request/day. */
  async scanDueSoon(): Promise<number> {
    const tomorrow = localDayOffset(1);
    const due = await this.db
      .requests()
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.device', 'device')
      .leftJoinAndSelect('r.requester', 'requester')
      .where('r.state = :s', { s: 'active' })
      .andWhere('r.toDate <= :tomorrow', { tomorrow })
      .getMany();
    let sent = 0;
    for (const r of due) {
      const dupe = await this.db
        .notifications()
        .createQueryBuilder('n')
        .where(`n.event = 'due_soon'`)
        .andWhere(`n.meta->>'requestId' = :id`, { id: r.id })
        .andWhere(`n.createdAt > now() - interval '20 hours'`)
        .getOne();
      if (dupe) continue;
      await this.db.withTransaction(async (ctx) => {
        await notify(ctx.manager, 'due_soon', [r.requesterId],
          `${r.device.brand} ${r.device.model} is due back ${r.toDate} — plan the return`,
          { requestId: r.id }, '/requests');
      });
      sent++;
    }
    return sent;
  }

  /** Sends pending outbox emails. Failures stay visible with the error. */
  async drainOutbox(): Promise<void> {
    // Atomic claim: bump next_attempt_at so an overlapping drain (or a
    // second replica) skips these rows instead of double-sending. If we
    // crash mid-send, the row simply becomes claimable again in 2 min.
    const claimed: EmailOutbox[] = await this.db
      .emailOutbox()
      .query(
        `UPDATE email_outbox SET next_attempt_at = now() + interval '2 minutes'
         WHERE id IN (
           SELECT id FROM email_outbox
           WHERE state = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
           ORDER BY id LIMIT 20
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, to_email AS "toEmail", subject, body, attempts`,
      );
    if (!claimed.length) return;
    if (!config.smtpUrl) {
      if (!this.smtpWarned) {
        this.log.warn(`SMTP_URL not set — ${claimed.length}+ email(s) stay pending in the outbox`);
        this.smtpWarned = true;
      }
      return;
    }
    const transport = nodemailer.createTransport(config.smtpUrl);
    for (const mail of claimed) {
      try {
        await transport.sendMail({
          from: config.smtpFrom,
          to: mail.toEmail,
          subject: mail.subject,
          text: mail.body,
        });
        await this.db.emailOutbox().update(mail.id, {
          state: 'sent',
          sentAt: new Date(),
          lastError: null,
        });
      } catch (e) {
        const attempts = mail.attempts + 1;
        const lastError = e instanceof Error ? e.message : String(e);
        // Exponential backoff: 1m, 2m, 4m … capped at 6h. 'failed' only
        // after 10 real attempts (~a day of SMTP being down), never after
        // five minutes of hiccup.
        const backoffMin = Math.min(2 ** (attempts - 1), 360);
        await this.db.emailOutbox().update(mail.id, {
          attempts,
          lastError,
          state: attempts >= 10 ? 'failed' : 'pending',
          nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
        });
        this.log.error(`email to ${mail.toEmail} failed (attempt ${attempts}): ${lastError}`);
      }
    }
  }
}
