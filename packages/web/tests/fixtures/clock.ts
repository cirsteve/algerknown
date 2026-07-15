import type { Clock } from '@algerknown/governed';

/** Deterministic, manually-advanceable clock for testing absolute expiry. */
export function createTestClock(startIso = '2026-01-01T00:00:00.000Z'): Clock & { advanceMs(ms: number): void } {
  let currentMs = Date.parse(startIso);
  return {
    now: () => new Date(currentMs).toISOString(),
    advanceMs(ms: number) {
      currentMs += ms;
    },
  };
}
