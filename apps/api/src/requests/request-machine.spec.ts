import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { transition } from './request-machine';
import {
  DeviceRequest,
  REQUEST_TRANSITIONS,
  RequestState,
} from '../entities/device-request.entity';

const req = (state: RequestState) => ({ state }) as DeviceRequest;
const ALL: RequestState[] = [
  'pending',
  'approved',
  'rejected',
  'active',
  'returned',
  'overdue',
  'cancelled',
];

describe('request state machine', () => {
  it('allows every legal transition', () => {
    for (const [from, tos] of Object.entries(REQUEST_TRANSITIONS)) {
      for (const to of tos) {
        const r = req(from as RequestState);
        expect(transition(r, to)).toBe(from);
        expect(r.state).toBe(to);
      }
    }
  });

  it('rejects every illegal transition with 409', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        if ((REQUEST_TRANSITIONS[from] ?? []).includes(to)) continue;
        expect(() => transition(req(from), to), `${from} → ${to}`).toThrow(
          ConflictException,
        );
      }
    }
  });

  it('terminal states go nowhere', () => {
    for (const terminal of ['rejected', 'returned', 'cancelled'] as const) {
      expect(REQUEST_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it('the happy path walks pending → approved → active → returned', () => {
    const r = req('pending');
    transition(r, 'approved');
    transition(r, 'active');
    transition(r, 'returned');
    expect(r.state).toBe('returned');
  });

  it('overdue can still be returned', () => {
    const r = req('active');
    transition(r, 'overdue');
    transition(r, 'returned');
    expect(r.state).toBe('returned');
  });
});
