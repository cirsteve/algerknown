import { describe, expect, it } from 'vitest';
import { canonicalStringify, contentHash } from '../../src/sqlite/canonical.js';

describe('canonical serialization', () => {
  it('sorts object keys regardless of insertion order', () => {
    const a = canonicalStringify({ b: 1, a: 2, c: 3 });
    const b = canonicalStringify({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it('recurses into nested objects and arrays', () => {
    const a = canonicalStringify({ arr: [{ y: 1, x: 2 }], z: { b: 1, a: 1 } });
    const b = canonicalStringify({ z: { a: 1, b: 1 }, arr: [{ x: 2, y: 1 }] });
    expect(a).toBe(b);
  });

  it('treats undefined as null', () => {
    expect(canonicalStringify(undefined)).toBe('null');
  });

  it('produces a stable hash independent of key order', () => {
    const h1 = contentHash({ foo: 'bar', baz: [1, 2, 3] });
    const h2 = contentHash({ baz: [1, 2, 3], foo: 'bar' });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different hash for different content', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
