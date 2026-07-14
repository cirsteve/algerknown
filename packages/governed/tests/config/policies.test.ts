import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NODE_SCHEMAS,
  SchemaRegistry,
  resolveConfidenceFloor,
  resolveVolumeCap,
  resolveAuditEvery,
  type ConfidencePolicy,
  type VolumePolicy,
  type AuditPolicy,
} from '../../src/config/index.js';

describe('SchemaRegistry', () => {
  const registry = new SchemaRegistry(DEFAULT_NODE_SCHEMAS);

  it('validates a well-formed fact payload', () => {
    expect(registry.validate('fact', { statement: 'water is wet' }).valid).toBe(true);
  });

  it('rejects a fact payload missing the required field', () => {
    const result = registry.validate('fact', { attributes: {} });
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('rejects unknown additional properties', () => {
    const result = registry.validate('resource', { locator: 'https://example.com', extra: true });
    expect(result.valid).toBe(false);
  });

  it('validates all seven default node type schemas against a minimal payload', () => {
    expect(registry.validate('prohibition', { rule: 'no writes' }).valid).toBe(true);
    expect(registry.validate('observation', { description: 'saw something' }).valid).toBe(true);
    expect(registry.validate('interaction', { summary: 'a chat happened' }).valid).toBe(true);
    expect(registry.validate('decision', { statement: 'we chose X' }).valid).toBe(true);
    expect(registry.validate('proposal', { proposalId: 'p-1', summary: 'proposed X' }).valid).toBe(true);
  });
});

describe('confidence policy', () => {
  const policy: ConfidencePolicy = { floors: { fact: 0.8 }, defaultFloor: 0.4 };

  it('uses a per-type floor when configured', () => {
    expect(resolveConfidenceFloor(policy, 'fact')).toBe(0.8);
  });

  it('falls back to the default floor otherwise', () => {
    expect(resolveConfidenceFloor(policy, 'observation')).toBe(0.4);
  });
});

describe('volume policy', () => {
  const policy: VolumePolicy = {
    perProcessorCap: { 'proc-1': { windowMs: 60_000, maxWrites: 10 } },
  };

  it('returns the per-processor cap when present', () => {
    expect(resolveVolumeCap(policy, 'proc-1')).toEqual({ windowMs: 60_000, maxWrites: 10 });
  });

  it('returns undefined when no cap and no default is configured', () => {
    expect(resolveVolumeCap(policy, 'proc-2')).toBeUndefined();
  });
});

describe('audit policy', () => {
  const policy: AuditPolicy = {
    defaultEvery: 10,
    perProcessorEvery: { 'proc-1': 5 },
    perNamespaceEvery: { 'memory.community.x': 2 },
  };

  it('prefers a per-processor sampling rate', () => {
    expect(resolveAuditEvery(policy, 'memory.community.x', 'proc-1')).toBe(5);
  });

  it('falls back to per-namespace, then default', () => {
    expect(resolveAuditEvery(policy, 'memory.community.x', 'proc-2')).toBe(2);
    expect(resolveAuditEvery(policy, 'operation.jobs')).toBe(10);
  });
});
