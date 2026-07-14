import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asNodeId,
  asEdgeId,
  asNamespaceId,
  asSubjectId,
  asRevisionId,
  CANONICAL_ONLY_NODE_TYPES,
  EDGE_KINDS,
  NODE_TYPES,
  type GovernedNode,
  type GovernedEdge,
} from '../../src/domain/index.js';

describe('governed node envelope', () => {
  it('discriminates payload shape by node type', () => {
    const fact: GovernedNode = {
      id: asNodeId('node-1'),
      type: 'fact',
      namespace: asNamespaceId('canonical.global'),
      subject: asSubjectId('subject-1'),
      payload: { statement: 'the sky is blue' },
      confidence: 0.9,
      provenance: {
        sources: [{ kind: 'external', id: 'src-1' }],
        railId: 'human',
        evaluatorVerdicts: [],
      },
      revision: {
        revisionId: asRevisionId('rev-1'),
        namespaceRevision: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        actorId: asActorId('actor-1'),
        actorClass: 'human',
      },
    };

    expect(fact.payload.statement).toBe('the sky is blue');
  });

  it('lists exactly the seven node types and three canonical-only types', () => {
    expect(NODE_TYPES).toHaveLength(7);
    expect(CANONICAL_ONLY_NODE_TYPES).toEqual(['fact', 'resource', 'prohibition']);
  });

  it('lists exactly the five governed edge kinds', () => {
    expect(EDGE_KINDS).toEqual(['derived_from', 'contradicts', 'supersedes', 'about', 'evidence_for']);
  });

  it('models an edge with stable endpoint metadata', () => {
    const edge: GovernedEdge = {
      id: asEdgeId('edge-1'),
      kind: 'derived_from',
      namespace: asNamespaceId('canonical.global'),
      sourceId: asNodeId('node-1'),
      targetId: asNodeId('node-2'),
      provenance: { sources: [{ kind: 'node', id: 'node-2' }], railId: 'human', evaluatorVerdicts: [] },
      revision: {
        revisionId: asRevisionId('rev-2'),
        namespaceRevision: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
        actorId: asActorId('actor-1'),
        actorClass: 'human',
      },
    };

    expect(edge.sourceId).toBe('node-1');
    expect(edge.targetId).toBe('node-2');
  });
});
