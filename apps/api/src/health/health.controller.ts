import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { Public } from '../auth/auth.guard';
import { AppDbContext } from '../db/app-db-context';
import { REDIS } from '../redis';

type Probe = 'up' | 'down';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: AppDbContext,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async health() {
    const [db, redis] = await Promise.all([this.probeDb(), this.probeRedis()]);
    const body = { status: db === 'up' && redis === 'up' ? 'ok' : 'degraded', db, redis };
    if (body.status !== 'ok') {
      // Loud failure: a broken dependency must never read as healthy.
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async probeDb(): Promise<Probe> {
    try {
      await this.db.raw.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async probeRedis(): Promise<Probe> {
    try {
      return (await this.redis.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
