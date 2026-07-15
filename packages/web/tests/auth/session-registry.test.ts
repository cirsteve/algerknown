import { describe, expect, it } from 'vitest';
import { createSessionRegistry, SESSION_TTL_MS } from '../../src/server/auth/session-registry.js';
import { createTestClock } from '../fixtures/clock.js';

const REVIEWER = { id: 'steve', displayName: 'Steve' };

describe('SessionRegistry', () => {
  it('issues independent session and CSRF tokens', () => {
    const registry = createSessionRegistry({ clock: createTestClock() });
    const issued = registry.issue(REVIEWER);
    expect(issued.sessionToken).not.toBe(issued.csrfToken);
    expect(issued.reviewer).toEqual(REVIEWER);
  });

  it('validates a freshly issued session', () => {
    const registry = createSessionRegistry({ clock: createTestClock() });
    const issued = registry.issue(REVIEWER);
    const record = registry.validate(issued.sessionToken);
    expect(record?.reviewer).toEqual(REVIEWER);
  });

  it('rejects an unknown session token', () => {
    const registry = createSessionRegistry({ clock: createTestClock() });
    expect(registry.validate('not-a-real-token')).toBeUndefined();
  });

  it('verifies a matching CSRF token and rejects a mismatched one', () => {
    const registry = createSessionRegistry({ clock: createTestClock() });
    const issued = registry.issue(REVIEWER);
    expect(registry.verifyCsrf(issued.sessionToken, issued.csrfToken)).toBe(true);
    expect(registry.verifyCsrf(issued.sessionToken, 'wrong-csrf')).toBe(false);
  });

  it('rotates the CSRF token, invalidating the old one', () => {
    const registry = createSessionRegistry({ clock: createTestClock() });
    const issued = registry.issue(REVIEWER);
    const rotated = registry.rotateCsrf(issued.sessionToken);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(issued.csrfToken);
    expect(registry.verifyCsrf(issued.sessionToken, issued.csrfToken)).toBe(false);
    expect(registry.verifyCsrf(issued.sessionToken, rotated as string)).toBe(true);
  });

  it('logout destroys the session so it no longer validates', () => {
    const registry = createSessionRegistry({ clock: createTestClock() });
    const issued = registry.issue(REVIEWER);
    registry.destroy(issued.sessionToken);
    expect(registry.validate(issued.sessionToken)).toBeUndefined();
  });

  it('enforces absolute expiry using the injected clock and does not slide on activity', () => {
    const clock = createTestClock();
    const registry = createSessionRegistry({ clock });
    const issued = registry.issue(REVIEWER);

    clock.advanceMs(SESSION_TTL_MS - 1000);
    expect(registry.validate(issued.sessionToken)).toBeDefined();

    clock.advanceMs(2000);
    expect(registry.validate(issued.sessionToken)).toBeUndefined();
  });

  it('activity does not extend expiry (non-sliding session)', () => {
    const clock = createTestClock();
    const registry = createSessionRegistry({ clock });
    const issued = registry.issue(REVIEWER);

    clock.advanceMs(SESSION_TTL_MS - 5000);
    registry.validate(issued.sessionToken);
    registry.rotateCsrf(issued.sessionToken);

    clock.advanceMs(6000);
    expect(registry.validate(issued.sessionToken)).toBeUndefined();
  });

  it('sweepExpired removes only sessions past their absolute expiry', () => {
    const clock = createTestClock();
    const registry = createSessionRegistry({ clock });
    registry.issue(REVIEWER);
    clock.advanceMs(SESSION_TTL_MS + 1);
    const removed = registry.sweepExpired();
    expect(removed).toBe(1);
    expect(registry.sweepExpired()).toBe(0);
  });

  it('a fresh registry (simulating server restart) has no memory of prior sessions', () => {
    const clock = createTestClock();
    const registry = createSessionRegistry({ clock });
    const issued = registry.issue(REVIEWER);

    const restarted = createSessionRegistry({ clock });
    expect(restarted.validate(issued.sessionToken)).toBeUndefined();
  });
});
