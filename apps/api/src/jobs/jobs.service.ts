import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { config } from '../config';
import { AppDbContext } from '../db/app-db-context';
import { EmailOutbox } from '../entities/notification.entity';
import { writeAudit } from '../audit/audit';
import { notify, staffIds } from '../notifications/notify';

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
    await this.queue.upsertJobScheduler('overdue-scan', { pattern: '0 * * * *' });
    await this.queue.upsertJobScheduler('due-soon-scan', { pattern: '0 8 * * *' });
    await this.queue.upsertJobScheduler('email-outbox', { pattern: '* * * * *' });
    this.worker = new Worker(
      SCHEDULER_QUEUE,
      async (job) => {
        if (job.name === 'overdue-scan') await this.scanOverdue();
        if (job.name === 'due-soon-scan') await this.scanDueSoon();
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

  /** Marks active requests past their to-date as overdue. Returns count. */
  async scanOverdue(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const late = await this.db
      .requests()
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.device', 'device')
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
        await writeAudit(ctx.manager, SYSTEM_ACTOR, {
          entityType: 'request',
          entityId: r.id,
          action: 'marked_overdue',
          oldValue: { state: old },
          newValue: { state: 'overdue', dueDate: r.toDate },
        });
        const name = `${r.device.brand} ${r.device.model}`;
        await notify(ctx.manager, 'overdue', [r.requesterId],
          `${name} is overdue — it was due back ${r.toDate}`, { requestId: r.id }, '/requests');
        await notify(ctx.manager, 'overdue', await staffIds(ctx.manager),
          `${name} is overdue (due ${r.toDate})`, { requestId: r.id }, '/loans');
      });
    }
    if (late.length) this.log.warn(`overdue scan: ${late.length} request(s) marked overdue`);
    return late.length;
  }

  /** Reminds holders the day before a return is due. De-duped per request/day. */
  async scanDueSoon(): Promise<number> {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const due = await this.db
      .requests()
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.device', 'device')
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
