import type { Clock } from '@algerknown/governed';
import { constantTimeHexEqual, generateRawToken, sha256Hex } from './secrets.js';

export const SESSION_TTL_MS = 30 * 60 * 1000;

export interface SessionReviewer {
  id: string;
  displayName: string;
}

export interface IssuedSession {
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
  reviewer: SessionReviewer;
}

export interface SessionRecord {
  reviewer: SessionReviewer;
  expiresAt: string;
}

interface StoredSession {
  reviewer: SessionReviewer;
  csrfTokenHash: string;
  expiresAt: number;
}

export interface SessionRegistry {
  issue(reviewer: SessionReviewer): IssuedSession;
  validate(sessionToken: string): SessionRecord | undefined;
  rotateCsrf(sessionToken: string): string | undefined;
  verifyCsrf(sessionToken: string, suppliedCsrfToken: string): boolean;
  destroy(sessionToken: string): void;
  sweepExpired(): number;
}

export interface SessionRegistryDeps {
  clock: Clock;
  ttlMs?: number;
}

/**
 * Sessions and CSRF tokens are stored only as SHA-256 hashes, keyed by the
 * hash of the session token, so server memory never holds a raw active
 * token or the configured reviewer secret. Expiry is absolute (set once at
 * issue time) and is never extended by activity.
 */
export function createSessionRegistry(deps: SessionRegistryDeps): SessionRegistry {
  const { clock } = deps;
  const ttlMs = deps.ttlMs ?? SESSION_TTL_MS;
  const sessions = new Map<string, StoredSession>();

  function nowMs(): number {
    return Date.parse(clock.now());
  }

  function purgeIfExpired(hashedToken: string, record: StoredSession): boolean {
    if (record.expiresAt <= nowMs()) {
      sessions.delete(hashedToken);
      return true;
    }
    return false;
  }

  return {
    issue(reviewer) {
      const sessionToken = generateRawToken();
      const csrfToken = generateRawToken();
      const issuedAtMs = nowMs();
      const expiresAtMs = issuedAtMs + ttlMs;
      sessions.set(sha256Hex(sessionToken), {
        reviewer,
        csrfTokenHash: sha256Hex(csrfToken),
        expiresAt: expiresAtMs,
      });
      return {
        sessionToken,
        csrfToken,
        expiresAt: new Date(expiresAtMs).toISOString(),
        reviewer,
      };
    },

    validate(sessionToken) {
      const hashedToken = sha256Hex(sessionToken);
      const record = sessions.get(hashedToken);
      if (!record) return undefined;
      if (purgeIfExpired(hashedToken, record)) return undefined;
      return { reviewer: record.reviewer, expiresAt: new Date(record.expiresAt).toISOString() };
    },

    rotateCsrf(sessionToken) {
      const hashedToken = sha256Hex(sessionToken);
      const record = sessions.get(hashedToken);
      if (!record) return undefined;
      if (purgeIfExpired(hashedToken, record)) return undefined;
      const csrfToken = generateRawToken();
      record.csrfTokenHash = sha256Hex(csrfToken);
      return csrfToken;
    },

    verifyCsrf(sessionToken, suppliedCsrfToken) {
      const hashedToken = sha256Hex(sessionToken);
      const record = sessions.get(hashedToken);
      if (!record) return false;
      if (purgeIfExpired(hashedToken, record)) return false;
      return constantTimeHexEqual(sha256Hex(suppliedCsrfToken), record.csrfTokenHash);
    },

    destroy(sessionToken) {
      sessions.delete(sha256Hex(sessionToken));
    },

    sweepExpired() {
      const threshold = nowMs();
      let removed = 0;
      for (const [hashedToken, record] of sessions) {
        if (record.expiresAt <= threshold) {
          sessions.delete(hashedToken);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
