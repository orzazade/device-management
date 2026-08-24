import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { config } from './config';
import { User } from './entities/user.entity';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  await app.register(require('@fastify/multipart'), {
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  // The factory-default admin password must not survive quietly in
  // production. Login already forces a change; this makes it visible in
  // the logs on every boot until it is gone.
  if (config.env === 'production') {
    const admins = await app
      .get(DataSource)
      .getRepository(User)
      .find({ where: { role: 'admin', active: true } });
    for (const a of admins) {
      if (bcrypt.compareSync('admin123', a.passwordHash)) {
        console.error(
          `SECURITY: admin account ${a.email} still uses the factory-default password — sign in and change it NOW`,
        );
      }
    }
  }

  await app.listen(config.port, '0.0.0.0');
  console.log(`api listening on :${config.port} (${config.env})`);
}

bootstrap().catch((err) => {
  // Loud failure: a dead boot must kill the process, not hang half-alive.
  console.error('api failed to start', err);
  process.exit(1);
});
