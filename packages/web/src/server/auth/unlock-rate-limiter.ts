import type { Clock } from '@algerknown/governed';

export interface UnlockRateLimiter {
  isBlocked(remoteAddress: string): boolean;
  registerFailure(remoteAddress: string): void;
  registerSuccess(remoteAddress: string): void;
}

export interface UnlockRateLimiterDeps {
  clock: Clock;
  maxAttempts?: number;
  windowMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 60 * 1000;

/** Tracks unlock failures per remote address in a rolling window, in memory. */
export function createUnlockRateLimiter(deps: UnlockRateLimiterDeps): UnlockRateLimiter {
  const { clock } = deps;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS;
  const failuresByAddress = new Map<string, number[]>();

  function nowMs(): number {
    return Date.parse(clock.now());
  }

  function recentFailures(remoteAddress: string): number[] {
    const threshold = nowMs() - windowMs;
    const failures = (failuresByAddress.get(remoteAddress) ?? []).filter((at) => at > threshold);
    failuresByAddress.set(remoteAddress, failures);
    return failures;
  }

  return {
    isBlocked(remoteAddress) {
      return recentFailures(remoteAddress).length >= maxAttempts;
    },

    registerFailure(remoteAddress) {
      const failures = recentFailures(remoteAddress);
      failures.push(nowMs());
      failuresByAddress.set(remoteAddress, failures);
    },

    registerSuccess(remoteAddress) {
      failuresByAddress.delete(remoteAddress);
    },
  };
}
