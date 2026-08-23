import { ConflictException } from '@nestjs/common';
import {
  DeviceRequest,
  REQUEST_TRANSITIONS,
  RequestState,
} from '../entities/device-request.entity';

/**
 * The one gate every state change goes through. Illegal jumps are a 409,
 * not a silent overwrite (ARCH.md: state machines are the heart).
 */
export function transition(request: DeviceRequest, to: RequestState): RequestState {
  const allowed = REQUEST_TRANSITIONS[request.state] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictException(
      `Request is "${request.state}" — it cannot become "${to}"`,
    );
  }
  const from = request.state;
  request.state = to;
  return from;
}
