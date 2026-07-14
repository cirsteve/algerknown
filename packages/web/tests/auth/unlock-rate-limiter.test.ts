import { describe, expect, it } from 'vitest';
import { createUnlockRateLimiter } from '../../src/server/auth/unlock-rate-limiter.js';
import { createTestClock } from '../fixtures/clock.js';

describe('UnlockRateLimiter', () => {
  it('allows up to the configured attempt count within the window', () => {
    const limiter = createUnlockRateLimiter({ clock: createTestClock() });
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.isBlocked('127.0.0.1')).toBe(false);
      limiter.registerFailure('127.0.0.1');
    }
    expect(limiter.isBlocked('127.0.0.1')).toBe(true);
  });

  it('tracks remote addresses independently', () => {
    const limiter = createUnlockRateLimiter({ clock: createTestClock() });
    for (let i = 0; i < 5; i += 1) limiter.registerFailure('127.0.0.1');
    expect(limiter.isBlocked('127.0.0.1')).toBe(true);
    expect(limiter.isBlocked('10.0.0.9')).toBe(false);
  });

  it('resets once the rolling window passes', () => {
    const clock = createTestClock();
    const limiter = createUnlockRateLimiter({ clock });
    for (let i = 0; i < 5; i += 1) limiter.registerFailure('127.0.0.1');
    expect(limiter.isBlocked('127.0.0.1')).toBe(true);

    clock.advanceMs(61_000);
    expect(limiter.isBlocked('127.0.0.1')).toBe(false);
  });

  it('a success clears prior failures for that address', () => {
    const limiter = createUnlockRateLimiter({ clock: createTestClock() });
    for (let i = 0; i < 4; i += 1) limiter.registerFailure('127.0.0.1');
    limiter.registerSuccess('127.0.0.1');
    limiter.registerFailure('127.0.0.1');
    expect(limiter.isBlocked('127.0.0.1')).toBe(false);
  });
});
