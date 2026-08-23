import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.setGlobalPrefix('api/v1');
  await app.listen(config.port, '0.0.0.0');
  console.log(`api listening on :${config.port} (${config.env})`);
}

bootstrap().catch((err) => {
  // Loud failure: a dead boot must kill the process, not hang half-alive.
  console.error('api failed to start', err);
  process.exit(1);
});
