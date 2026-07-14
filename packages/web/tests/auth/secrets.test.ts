import { describe, expect, it } from 'vitest';
import { constantTimeHexEqual, generateRawToken, secretMatches, sha256Hex } from '../../src/server/auth/secrets.js';

describe('secrets', () => {
  it('hashes deterministically', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'));
    expect(sha256Hex('hello')).not.toBe(sha256Hex('world'));
  });

  it('reports matching secrets as equal', () => {
    expect(secretMatches('correct-horse-battery-staple', 'correct-horse-battery-staple')).toBe(true);
  });

  it('reports non-matching secrets as unequal', () => {
    expect(secretMatches('wrong', 'correct-horse-battery-staple')).toBe(false);
  });

  it('rejects hashes of differing length in constant-time compare', () => {
    expect(constantTimeHexEqual('ab', 'abcd')).toBe(false);
  });

  it('generates distinct random tokens each call', () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
