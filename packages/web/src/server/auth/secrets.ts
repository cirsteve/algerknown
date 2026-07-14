import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Constant-time equality over two hex-encoded SHA-256 digests. Both inputs
 * are expected to be fixed-length (64 hex chars) in normal use, since every
 * caller passes a sha256Hex() output; the length check is a defensive
 * guard for misuse (e.g. a malformed input) and rejects before the
 * constant-time comparison rather than leaking anything through it.
 */
export function constantTimeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** True when the supplied plaintext secret matches the configured plaintext secret. */
export function secretMatches(suppliedSecret: string, configuredSecret: string): boolean {
  return constantTimeHexEqual(sha256Hex(suppliedSecret), sha256Hex(configuredSecret));
}

/** Generates a 256-bit random token, returned hex-encoded. */
export function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}
