import { describe, expect, it } from 'vitest';
import { findForbiddenIdentityField } from '../../src/server/auth/reject-identity-fields.js';

describe('findForbiddenIdentityField', () => {
  it('finds a forbidden field at the top level', () => {
    expect(findForbiddenIdentityField({ reviewer_id: 'attacker' })).toBe('reviewer_id');
  });

  it('finds a forbidden field nested inside an object', () => {
    expect(findForbiddenIdentityField({ note: 'ok', meta: { reviewer_id: 'attacker' } })).toBe('reviewer_id');
  });

  it('finds a forbidden field nested inside an array', () => {
    expect(findForbiddenIdentityField({ items: [{ note: 'ok' }, { channel: 'browser' }] })).toBe('channel');
  });

  it('finds a forbidden field nested several levels deep', () => {
    expect(findForbiddenIdentityField({ a: { b: { c: [{ mutation_hash: 'x' }] } } })).toBe('mutation_hash');
  });

  it('returns undefined for a body with no forbidden fields at any depth', () => {
    expect(findForbiddenIdentityField({ note: 'ok', meta: { tag: 'x', items: [1, 2, 3] } })).toBeUndefined();
  });

  it('returns undefined for non-object bodies', () => {
    expect(findForbiddenIdentityField(null)).toBeUndefined();
    expect(findForbiddenIdentityField('reviewer_id')).toBeUndefined();
    expect(findForbiddenIdentityField(42)).toBeUndefined();
  });
});
