import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { config } from '../config';
import { AppDbContext } from '../db/app-db-context';
import { writeAudit } from '../audit/audit';
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
 * stays disposable — all truth lives in Postgres.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('jobs');
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly db: AppDbContext) {}

  async onModuleInit() {
    this.queue = new Queue(SCHEDULER_QUEUE, { connection: redisConnection() });
    await this.queue.upsertJobScheduler('overdue-scan', { pattern: '0 * * * *' });
    this.worker = new Worker(
      SCHEDULER_QUEUE,
      async (job) => {
        if (job.name === 'overdue-scan') await this.scanOverdue();
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
      });
    }
    if (late.length) this.log.warn(`overdue scan: ${late.length} request(s) marked overdue`);
    return late.length;
  }
}
