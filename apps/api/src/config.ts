// Central env config. Defaults match docker-compose for local dev;
// production always overrides via real env vars.
export const config = {
  port: parseInt(process.env.PORT ?? '8080', 10),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://devmgmt:devmgmt@localhost:5433/devmgmt',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6380',
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-in-prod',
  jwtTtl: process.env.JWT_TTL ?? '12h',
  // e.g. smtp://user:pass@mail.corp.local:587 — unset means emails wait in the outbox
  smtpUrl: process.env.SMTP_URL ?? '',
  smtpFrom: process.env.SMTP_FROM ?? 'DeviceDesk <devicedesk@localhost>',
};

// Loud failure: a production boot with the dev JWT secret is a security hole.
if (config.env === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
