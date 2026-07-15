import { describe, expect, it } from 'vitest';
import { asNamespaceId } from '../../src/domain/index.js';
import {
  DEFAULT_NAMESPACE_TABLE,
  NamespaceConfigError,
  NamespaceMatcher,
  validateNamespaceTable,
  type NamespaceTableConfig,
} from '../../src/config/index.js';

describe('NamespaceMatcher over the default table', () => {
  const matcher = new NamespaceMatcher(DEFAULT_NAMESPACE_TABLE);

  it('prefers an exact literal match over a wildcard pattern', () => {
    const entry = matcher.resolve(asNamespaceId('canonical.global'));
    expect(entry.pattern).toBe('canonical.global');
    expect(entry.policy).toBe('human');
    expect(entry.class).toBe('canonical');
  });

  it('resolves wildcard project namespaces to human-gated canonical', () => {
    const entry = matcher.resolve(asNamespaceId('canonical.project.alpha'));
    expect(entry.pattern).toBe('canonical.project.*');
    expect(entry.policy).toBe('human-gated');
  });

  it('resolves memory.global distinctly from memory.project.*', () => {
    const global = matcher.resolve(asNamespaceId('memory.global'));
    const project = matcher.resolve(asNamespaceId('memory.project.foo'));
    expect(global.pattern).toBe('memory.global');
    expect(global.engine).toBe('sqlite');
    expect(project.pattern).toBe('memory.project.*');
    expect(project.engine).toBe('sqlite');
  });

  it('routes community and relationship memory namespaces to sqlite AI-with-rails', () => {
    const community = matcher.resolve(asNamespaceId('memory.community.deep-dive'));
    expect(community.engine).toBe('sqlite');
    expect(community.policy).toBe('ai-with-rails');

    const relationship = matcher.resolve(asNamespaceId('memory.relationship.pair-1'));
    expect(relationship.engine).toBe('sqlite');
    expect(relationship.policy).toBe('ai-with-rails');
  });

  it('marks operation.* append-only under AI-with-rails', () => {
    const entry = matcher.resolve(asNamespaceId('operation.ingest.job-1'));
    expect(entry.appendOnly).toBe(true);
    expect(entry.policy).toBe('ai-with-rails');
  });

  it('supports arbitrarily deep segments under a trailing wildcard', () => {
    const entry = matcher.resolve(asNamespaceId('memory.community.topic.sub.detail'));
    expect(entry.pattern).toBe('memory.community.*');
  });

  it('fails closed on an unmatched namespace', () => {
    expect(() => matcher.resolve(asNamespaceId('unknown.top.level'))).toThrowError(NamespaceConfigError);
  });
});

describe('validateNamespaceTable', () => {
  function tableWith(entries: NamespaceTableConfig['entries']): NamespaceTableConfig {
    return { entries, registeredEngines: ['algerknown', 'sqlite'], registeredPolicies: ['human', 'human-gated', 'ai-with-rails'] };
  }

  it('rejects duplicate patterns', () => {
    const table = tableWith([
      { pattern: 'canonical.global', class: 'canonical', engine: 'algerknown', policy: 'human' },
      { pattern: 'canonical.global', class: 'canonical', engine: 'algerknown', policy: 'human' },
    ]);
    expect(() => validateNamespaceTable(table)).toThrowError(/duplicate/i);
  });

  it('rejects an unregistered engine', () => {
    const table = tableWith([{ pattern: 'canonical.global', class: 'canonical', engine: 'unknown-engine', policy: 'human' }]);
    expect(() => validateNamespaceTable(table)).toThrowError(/engine/i);
  });

  it('rejects an unregistered policy', () => {
    const table = tableWith([{ pattern: 'canonical.global', class: 'canonical', engine: 'algerknown', policy: 'unknown-policy' }]);
    expect(() => validateNamespaceTable(table)).toThrowError(/policy/i);
  });

  it('accepts non-colliding same-tier wildcard patterns with differing literals', () => {
    const table = tableWith([
      { pattern: 'memory.project.*', class: 'memory', engine: 'algerknown', policy: 'human-gated' },
      { pattern: 'memory.other.*', class: 'memory', engine: 'algerknown', policy: 'human-gated' },
    ]);
    // Both tier 1, literalCount 2, but the literal segment at index 1 differs
    // ("project" vs "other"), so no concrete namespace could ever match both.
    expect(() => validateNamespaceTable(table)).not.toThrow();
  });

  it('rejects two distinct patterns that could tie for the same namespace', () => {
    // "a.*.c" (mid-wildcard, exact length 3) and "a.b.*" (trailing rest wildcard)
    // both match "a.b.c" and both have tier 1 with literalCount 2 -> genuinely ambiguous.
    const table = tableWith([
      { pattern: 'a.*.c', class: 'canonical', engine: 'algerknown', policy: 'human' },
      { pattern: 'a.b.*', class: 'canonical', engine: 'algerknown', policy: 'human' },
    ]);
    expect(() => validateNamespaceTable(table)).toThrowError(NamespaceConfigError);
    try {
      validateNamespaceTable(table);
    } catch (err) {
      expect(err).toBeInstanceOf(NamespaceConfigError);
      expect((err as InstanceType<typeof NamespaceConfigError>).code).toBe('AMBIGUOUS_PATTERNS');
    }
  });

  it('accepts the shipped default namespace table', () => {
    expect(() => validateNamespaceTable(DEFAULT_NAMESPACE_TABLE)).not.toThrow();
  });
});
