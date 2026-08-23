import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { config } from '../config';
import { AppDbContext } from '../db/app-db-context';
import { writeAudit } from '../audit/audit';
import { notify, staffIds } from '../notifications/notify';
import { transition } from '../requests/request-machine';

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
        const old = transition(r, 'overdue');
        await ctx.requests.save(r);
        await writeAudit(ctx.manager, SYSTEM_ACTOR, {
          entityType: 'request',
          entityId: r.id,
          action: 'marked_overdue',
          oldValue: { state: old },
          newValue: { state: 'overdue', dueDate: r.toDate },
        });
        const name = `${r.device.brand} ${r.device.model}`;
        await notify(ctx.manager, 'overdue', [r.requesterId],
          `${name} is overdue — it was due back ${r.toDate}`, { requestId: r.id });
        await notify(ctx.manager, 'overdue', await staffIds(ctx.manager),
          `${name} is overdue (due ${r.toDate})`, { requestId: r.id });
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
          { requestId: r.id });
      });
      sent++;
    }
    return sent;
  }

  /** Sends pending outbox emails. Failures stay visible with the error. */
  async drainOutbox(): Promise<void> {
    const pending = await this.db.emailOutbox().find({
      where: [{ state: 'pending' }],
      order: { id: 'ASC' },
      take: 20,
    });
    if (!pending.length) return;
    if (!config.smtpUrl) {
      if (!this.smtpWarned) {
        this.log.warn(`SMTP_URL not set — ${pending.length}+ email(s) stay pending in the outbox`);
        this.smtpWarned = true;
      }
      return;
    }
    const transport = nodemailer.createTransport(config.smtpUrl);
    for (const mail of pending) {
      try {
        await transport.sendMail({
          from: config.smtpFrom,
          to: mail.toEmail,
          subject: mail.subject,
          text: mail.body,
        });
        mail.state = 'sent';
        mail.sentAt = new Date();
        mail.lastError = null;
      } catch (e) {
        mail.attempts += 1;
        mail.lastError = e instanceof Error ? e.message : String(e);
        if (mail.attempts >= 5) mail.state = 'failed';
        this.log.error(`email to ${mail.toEmail} failed (attempt ${mail.attempts}): ${mail.lastError}`);
      }
      await this.db.emailOutbox().save(mail);
    }
  }
}
