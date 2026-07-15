import type { Clock } from '../../src/index.js';

/** Deterministic clock: each call advances one second from a fixed epoch. */
export function createTestClock(): Clock {
  let seconds = 0;
  return {
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds++)).toISOString(),
  };
}
