import Redis from 'ioredis';
import { config } from './config';

export const REDIS = 'REDIS_CLIENT';

export function createRedis(): Redis {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
}
