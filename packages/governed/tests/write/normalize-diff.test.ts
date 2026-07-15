import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asRevisionId,
  asSubjectId,
  type GovernedNode,
  type WriteCommand,
} from '../../src/domain/index.js';
import { buildNodeDiff, invertDiff, normalizeWriteCommand } from '../../src/write/index.js';

function baseCommand(overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: asNamespaceId('canonical.global'),
    subject: asSubjectId('subject-1'),
    nodeMutations: [
      { op: 'create', nodeId: asNodeId('n-2'), nodeType: 'fact', payload: { statement: 'b' }, confidence: 0.9 },
      { op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'a' }, confidence: 0.9 },
    ],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey('idem-1'),
    actorId: asActorId('actor-1'),
    actorClass: 'human',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
    ...overrides,
  };
}

describe('normalizeWriteCommand', () => {
  it('sorts node mutations deterministically regardless of input order', () => {
    const a = normalizeWriteCommand(baseCommand());
    const b = normalizeWriteCommand(
      baseCommand({
        nodeMutations: [
          { op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'a' }, confidence: 0.9 },
          { op: 'create', nodeId: asNodeId('n-2'), nodeType: 'fact', payload: { statement: 'b' }, confidence: 0.9 },
        ],
      }),
    );
    expect(a.command.nodeMutations.map((m) => m.nodeId)).toEqual(['n-1', 'n-2']);
    expect(a.mutationHash).toBe(b.mutationHash);
  });

  it('produces a different hash when payload content differs', () => {
    const a = normalizeWriteCommand(baseCommand());
    const b = normalizeWriteCommand(
      baseCommand({
        nodeMutations: [
          { op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'different' }, confidence: 0.9 },
        ],
      }),
    );
    expect(a.mutationHash).not.toBe(b.mutationHash);
  });

  it('is insensitive to key order within a mutation payload', () => {
    const a = normalizeWriteCommand(
      baseCommand({
        nodeMutations: [
          { op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'a', attributes: { x: 1, y: 2 } }, confidence: 0.9 },
        ],
      }),
    );
    const b = normalizeWriteCommand(
      baseCommand({
        nodeMutations: [
          { op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { attributes: { y: 2, x: 1 }, statement: 'a' }, confidence: 0.9 },
        ],
      }),
    );
    expect(a.mutationHash).toBe(b.mutationHash);
  });
});

function makeFact(statement: string, confidence: number): GovernedNode {
  return {
    id: asNodeId('n-1'),
    type: 'fact',
    namespace: asNamespaceId('canonical.global'),
    subject: asSubjectId('subject-1'),
    payload: { statement },
    confidence,
    provenance: { sources: [{ kind: 'external', id: 'src-1' }], railId: 'human', evaluatorVerdicts: [] },
    revision: {
      revisionId: asRevisionId('rev-1'),
      namespaceRevision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      actorId: asActorId('actor-1'),
      actorClass: 'human',
    },
  };
}

describe('node-level diff and reversal', () => {
  it('produces a create diff with a null-before / node-after pair', () => {
    const after = makeFact('the sky is blue', 0.9);
    const diff = buildNodeDiff(after.id, 'create', undefined, after);
    expect(diff.forward).toEqual([{ path: '$', before: null, after }]);
    expect(diff.inverse).toEqual([{ path: '$', before: after, after: null }]);
  });

  it('produces a field-level update diff for a changed payload field', () => {
    const before = makeFact('the sky is blue', 0.9);
    const after = makeFact('the sky is grey', 0.9);
    const diff = buildNodeDiff(before.id, 'update', before, after);
    expect(diff.forward).toEqual([{ path: 'payload.statement', before: 'the sky is blue', after: 'the sky is grey' }]);
    expect(diff.inverse).toEqual([{ path: 'payload.statement', before: 'the sky is grey', after: 'the sky is blue' }]);
  });

  it('inverts a full diff set so a revert can be applied as a new revision', () => {
    const after = makeFact('the sky is blue', 0.9);
    const createDiff = buildNodeDiff(after.id, 'create', undefined, after);
    const inverted = invertDiff([createDiff]);
    expect(inverted[0]?.changeKind).toBe('delete');
    expect(inverted[0]?.forward).toEqual(createDiff.inverse);
    expect(inverted[0]?.inverse).toEqual(createDiff.forward);
  });
});
