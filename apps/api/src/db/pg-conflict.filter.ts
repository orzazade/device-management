import { ArgumentsHost, Catch, ConflictException, ExceptionFilter } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

/** Any unique-constraint hit becomes a clean 409 instead of a raw 500 —
 * covers every current and future unique column in one place. */
@Catch(QueryFailedError)
export class PgConflictFilter implements ExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const code = (exception as { driverError?: { code?: string } }).driverError?.code;
    const reply = host.switchToHttp().getResponse();
    if (code === '23505') {
      const err = new ConflictException(
        'That value is already taken — possibly by a deleted entry an Admin can restore',
      );
      reply.status(409).send(err.getResponse());
      return;
    }
    if (code === '23P01') {
      const err = new ConflictException(
        'This clashes with an existing booking for the same time range',
      );
      reply.status(409).send(err.getResponse());
      return;
    }
    // Anything else stays a real 500 — loudly.
    reply.status(500).send({ statusCode: 500, message: 'Internal server error' });
  }
}
