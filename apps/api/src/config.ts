// Central env config. Defaults match docker-compose for local dev;
// production always overrides via real env vars.
export const config = {
  port: parseInt(process.env.PORT ?? '8080', 10),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://devmgmt:devmgmt@localhost:5433/devmgmt',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6380',
  env: process.env.NODE_ENV ?? 'development',
};
