import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asAttestationId,
  asEdgeId,
  asIdempotencyKey,
  asMutationHash,
  asNamespaceId,
  asNodeId,
  asProcessorId,
  asProposalId,
  asRevisionId,
  asSubjectId,
  type GovernedNode,
  type NamespacePolicyEntry,
  type WriteCommand,
} from '../../src/domain/index.js';
import {
  evaluateOperationShape,
  evaluateLoadedTargets,
  evaluateTruthTypePlacement,
  evaluateAiTruthMutationBlock,
  evaluateNodeTypeKnown,
  evaluatePayloadSchema,
  evaluateActorClassAllowed,
  evaluateAttestationRequirement,
  evaluateProvenanceCompleteness,
  evaluateDerivedFromRequirement,
  evaluateProposalObservationSupport,
  evaluateConfidence,
  evaluateProcessorVolume,
  evaluateContradictions,
  computeAuditDirective,
} from '../../src/write/evaluators/index.js';
import { DEFAULT_NODE_SCHEMAS, SchemaRegistry, DEFAULT_CONFIDENCE_POLICY } from '../../src/config/index.js';

function canonicalGlobal(): NamespacePolicyEntry {
  return { pattern: 'canonical.global', class: 'canonical', engine: 'algerknown', policy: 'human' };
}

function aiCommunity(): NamespacePolicyEntry {
  return { pattern: 'memory.community.*', class: 'memory', engine: 'sqlite', policy: 'ai-with-rails' };
}

function operationAppendOnly(): NamespacePolicyEntry {
  return { pattern: 'operation.*', class: 'operation', engine: 'sqlite', policy: 'ai-with-rails', appendOnly: true };
}

function baseCommand(overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: asNamespaceId('canonical.global'),
    subject: asSubjectId('subject-1'),
    nodeMutations: [
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

describe('operation-shape evaluators', () => {
  it('rejects an empty command', () => {
    const verdict = evaluateOperationShape(baseCommand({ nodeMutations: [], edgeMutations: [] }), canonicalGlobal());
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('INVALID_MUTATION_SHAPE');
  });

  it('rejects update/delete/revert under an append-only namespace', () => {
    const command = baseCommand({ nodeMutations: [{ op: 'update', nodeId: asNodeId('n-1'), payload: { statement: 'b' } }] });
    const verdict = evaluateOperationShape(command, operationAppendOnly());
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('APPEND_ONLY_VIOLATION');
  });

  it('allows create under an append-only namespace', () => {
    const verdict = evaluateOperationShape(baseCommand(), operationAppendOnly());
    expect(verdict.passed).toBe(true);
  });

  it('rejects a command targeting a namespace-mismatched existing node', () => {
    const command = baseCommand({ nodeMutations: [{ op: 'update', nodeId: asNodeId('n-1'), payload: { statement: 'b' } }] });
    const verdict = evaluateLoadedTargets(command, {
      nodeNamespaces: new Map([[asNodeId('n-1'), asNamespaceId('memory.global')]]),
      edgeNamespaces: new Map(),
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('CROSS_NAMESPACE_COMMAND');
  });

  it('rejects an update against a target that was never loaded', () => {
    const command = baseCommand({ nodeMutations: [{ op: 'update', nodeId: asNodeId('missing'), payload: {} }] });
    const verdict = evaluateLoadedTargets(command, { nodeNamespaces: new Map(), edgeNamespaces: new Map() });
    expect(verdict.reasonCodes).toContain('TARGET_NOT_FOUND');
  });
});

describe('truth-protection evaluators (the two structural invariants)', () => {
  it('rejects a fact placed in a non-canonical namespace regardless of policy', () => {
    const verdict = evaluateTruthTypePlacement('fact', aiCommunity());
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('TRUTH_TYPE_REQUIRES_CANONICAL_NAMESPACE');
  });

  it('allows an observation in a non-canonical namespace', () => {
    expect(evaluateTruthTypePlacement('observation', aiCommunity()).passed).toBe(true);
  });

  it('blocks AI-with-rails from mutating a truth type even if class were misconfigured to canonical', () => {
    const misconfigured: NamespacePolicyEntry = { ...aiCommunity(), class: 'canonical' };
    const verdict = evaluateAiTruthMutationBlock('resource', misconfigured);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('AI_TRUTH_MUTATION_FORBIDDEN');
  });

  it('allows AI-with-rails to mutate non-truth types', () => {
    expect(evaluateAiTruthMutationBlock('observation', aiCommunity()).passed).toBe(true);
  });
});

describe('schema-type evaluators', () => {
  const registry = new SchemaRegistry(DEFAULT_NODE_SCHEMAS);

  it('rejects an unrecognized node type', () => {
    expect(evaluateNodeTypeKnown('not-a-real-type').passed).toBe(false);
  });

  it('rejects a payload that fails its schema', () => {
    const verdict = evaluatePayloadSchema(registry, 'fact', { attributes: {} });
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('SCHEMA_VALIDATION_FAILED');
  });

  it('accepts a valid payload', () => {
    expect(evaluatePayloadSchema(registry, 'fact', { statement: 'ok' }).passed).toBe(true);
  });
});

describe('actor and attestation evaluators', () => {
  it('rejects a processor actor under the human policy', () => {
    const verdict = evaluateActorClassAllowed('human', 'processor');
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('ACTOR_CLASS_NOT_PERMITTED_BY_POLICY');
  });

  it('requires attestation under human-gated policy', async () => {
    const command = baseCommand({ actorClass: 'processor' });
    const verdict = await evaluateAttestationRequirement(
      'human-gated',
      command,
      asMutationHash('hash-1'),
      { verify: async () => undefined },
      { save: async () => undefined, get: async () => undefined, findPendingByMutationHash: async () => undefined },
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('ATTESTATION_REQUIRED');
  });

  it('accepts a verified attestation matching the exact mutation and version', async () => {
    const command = baseCommand({ attestation: { attestationId: asAttestationId('att-1') } });
    const proposal = {
      id: asProposalId('p-1'),
      canonicalMutation: command,
      mutationHash: asMutationHash('hash-1'),
      targetNamespace: command.namespace,
      targetSubject: command.subject,
      expectedTargetRevision: null,
      supportingObservationIds: [],
      provenance: { sources: [], railId: 'human', evaluatorVerdicts: [] },
      version: 2,
      status: 'pending' as const,
      events: [],
    };
    const verdict = await evaluateAttestationRequirement(
      'human',
      command,
      asMutationHash('hash-1'),
      {
        verify: async () => ({
          id: asAttestationId('att-1'),
          reviewerId: asActorId('reviewer-1'),
          approvedAt: '2026-01-01T00:00:00.000Z',
          proposalId: proposal.id,
          proposalVersion: 2,
          targetRevision: null,
          mutationHash: asMutationHash('hash-1'),
          channel: 'test',
          verifierMeta: {},
        }),
      },
      { save: async () => undefined, get: async () => undefined, findPendingByMutationHash: async () => proposal },
    );
    expect(verdict.passed).toBe(true);
  });
});

describe('provenance-support evaluators', () => {
  it('rejects a command with no attributable source', () => {
    const command = baseCommand({ provenanceInput: { sources: [] } });
    expect(evaluateProvenanceCompleteness(command).passed).toBe(false);
  });

  it('requires a derived_from edge for a source-derived candidate', () => {
    const command = baseCommand({ provenanceInput: { sources: [{ kind: 'external', id: 's-1' }], sourceDerived: true } });
    expect(evaluateDerivedFromRequirement(command).passed).toBe(false);
  });

  it('accepts a source-derived candidate with a derived_from edge', () => {
    const command = baseCommand({
      provenanceInput: { sources: [{ kind: 'external', id: 's-1' }], sourceDerived: true },
      edgeMutations: [
        { op: 'create', edgeId: asEdgeId('e-1'), kind: 'derived_from', sourceId: asNodeId('n-1'), targetId: asNodeId('src-node') },
      ],
    });
    expect(evaluateDerivedFromRequirement(command).passed).toBe(true);
  });

  it('rejects a proposal with no supporting observation', () => {
    expect(evaluateProposalObservationSupport([], () => undefined).passed).toBe(false);
  });

  it('rejects a proposal whose supporting id resolves to a non-observation node', () => {
    const factNode = { type: 'fact' } as unknown as GovernedNode;
    const verdict = evaluateProposalObservationSupport([asNodeId('n-1')], () => factNode);
    expect(verdict.passed).toBe(false);
  });
});

describe('confidence and volume evaluators', () => {
  it('rejects a missing confidence value', () => {
    expect(evaluateConfidence(DEFAULT_CONFIDENCE_POLICY, 'fact', undefined).passed).toBe(false);
  });

  it('rejects a below-floor confidence value', () => {
    const verdict = evaluateConfidence({ floors: { fact: 0.8 }, defaultFloor: 0.5 }, 'fact', 0.5);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('CONFIDENCE_BELOW_FLOOR');
  });

  it('rejects once the processor volume cap is exhausted', async () => {
    const verdict = await evaluateProcessorVolume(
      { perProcessorCap: { 'proc-1': { windowMs: 60_000, maxWrites: 3 } } },
      { countInWindow: async () => 3, record: async () => undefined },
      asProcessorId('proc-1'),
      '2026-01-01T00:00:00.000Z',
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.reasonCodes).toContain('PROCESSOR_VOLUME_CAP_EXCEEDED');
  });

  it('passes when under the cap', async () => {
    const verdict = await evaluateProcessorVolume(
      { perProcessorCap: { 'proc-1': { windowMs: 60_000, maxWrites: 3 } } },
      { countInWindow: async () => 1, record: async () => undefined },
      asProcessorId('proc-1'),
      '2026-01-01T00:00:00.000Z',
    );
    expect(verdict.passed).toBe(true);
  });
});

describe('contradiction evaluator', () => {
  function fact(confidence: number): GovernedNode {
    return {
      id: asNodeId('n-2'),
      type: 'fact',
      namespace: asNamespaceId('canonical.global'),
      subject: asSubjectId('subject-1'),
      payload: { statement: 'x' },
      confidence,
      provenance: { sources: [], railId: 'human', evaluatorVerdicts: [] },
      revision: {
        revisionId: asRevisionId('rev-1'),
        namespaceRevision: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        actorId: asActorId('actor-1'),
        actorClass: 'human',
      },
    };
  }

  it('routes when a strictly higher-confidence live node contradicts', async () => {
    const candidate = fact(0.5);
    const result = await evaluateContradictions(
      { findContradictions: async () => [{ nodeId: asNodeId('n-2') }] },
      { namespace: candidate.namespace, subject: candidate.subject, candidateNode: candidate },
      async () => fact(0.9),
    );
    expect(result.verdict.passed).toBe(false);
    expect(result.contradictingNodeIds).toEqual(['n-2']);
  });

  it('does not route when the existing node has equal or lower confidence', async () => {
    const candidate = fact(0.9);
    const result = await evaluateContradictions(
      { findContradictions: async () => [{ nodeId: asNodeId('n-2') }] },
      { namespace: candidate.namespace, subject: candidate.subject, candidateNode: candidate },
      async () => fact(0.9),
    );
    expect(result.verdict.passed).toBe(true);
  });
});

describe('audit-sampling', () => {
  it('samples deterministically on the configured multiple, not randomly', () => {
    const policy = { defaultEvery: 5, perProcessorEvery: {}, perNamespaceEvery: {} };
    const namespace = asNamespaceId('memory.community.x');
    expect(computeAuditDirective(policy, namespace, 5).sampled).toBe(true);
    expect(computeAuditDirective(policy, namespace, 6).sampled).toBe(false);
    expect(computeAuditDirective(policy, namespace, 10).sampled).toBe(true);
  });
});
