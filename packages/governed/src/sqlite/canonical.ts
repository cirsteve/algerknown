import { createHash } from 'node:crypto';

/**
 * Deterministic key-sorted JSON serialization: two objects with the same
 * fields in a different order always produce the same string, so hashes,
 * idempotency comparisons, and reopen diffs stay stable across processes.
 */
export function canonicalStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

/** SHA-256 content hash of the canonical serialization of value, as lowercase hex. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}
