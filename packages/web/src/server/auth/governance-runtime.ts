import type { Clock } from '@algerknown/governed';
import { loadGovernanceConfig, type GovernanceConfig } from './governance-config.js';
import { createSessionRegistry, type SessionRegistry } from './session-registry.js';
import { createUnlockRateLimiter, type UnlockRateLimiter } from './unlock-rate-limiter.js';
import { systemClock } from './system-clock.js';

export interface GovernanceRuntime {
  config: GovernanceConfig;
  clock: Clock;
  sessionRegistry: SessionRegistry;
  unlockRateLimiter: UnlockRateLimiter;
}

export interface CreateGovernanceRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  clock?: Clock;
}

/**
 * Assembles the trust-profile config together with the session registry and
 * unlock rate limiter that share its clock. Passing a fixed clock (and env)
 * makes the whole runtime deterministic for tests; production wiring uses
 * the real system clock and process.env.
 */
export function createGovernanceRuntime(opts: CreateGovernanceRuntimeOptions = {}): GovernanceRuntime {
  const clock = opts.clock ?? systemClock;
  const config = loadGovernanceConfig(opts.env ?? process.env);
  return {
    config,
    clock,
    sessionRegistry: createSessionRegistry({ clock }),
    unlockRateLimiter: createUnlockRateLimiter({ clock }),
  };
}
