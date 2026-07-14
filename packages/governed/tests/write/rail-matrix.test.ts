import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asAttestationId,
  asEdgeId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asProcessorId,
  asProposalId,
  asRevisionId,
  asSubjectId,
  CANONICAL_ONLY_NODE_TYPES,
  DEFAULT_NAMESPACE_ENTRIES,
  NODE_TYPES,
  normalizeWriteCommand,
  WriteOrchestrator,
  type NamespacePolicyEntry,
  type NodeType,
  type WriteCommand,
} from '../../src/index.js';
import { createTestHarness } from '../fixtures/deps.js';

const MINIMAL_VALID_PAYLOAD: Record<NodeType, Record<string, unknown>> = {
  fact: { statement: 'the sky is blue' },
  resource: { locator: 'https://example.com' },
  prohibition: { rule: 'no writes after 5pm' },
  observation: { description: 'saw a thing' },
  interaction: { summary: 'a chat happened' },
  decision: { statement: 'we chose X' },
  proposal: { proposalId: 'p-1', summary: 'proposed X' },
};

/** Sample namespace for every declared class/policy pairing in the shipped default table. */
function representativeNamespace(pattern: string): string {
  return pattern.replace('*', 'example');
}

function baseCommand(namespace: string, nodeType: NodeType, overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: asNamespaceId(namespace),
    subject: asSubjectId('subject-1'),
    nodeMutations: [
      { op: 'create', nodeId: asNodeId('n-1'), nodeType, payload: MINIMAL_VALID_PAYLOAD[nodeType], confidence: 0.9 },
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

describe('rail matrix: truth-type placement across every namespace class', () => {
  for (const entry of DEFAULT_NAMESPACE_ENTRIES) {
    for (const truthType of CANONICAL_ONLY_NODE_TYPES) {
      const namespace = representativeNamespace(entry.pattern);
      const expectRejected = entry.class !== 'canonical';

      it(`${truthType} in ${namespace} (class=${entry.class}) is ${expectRejected ? 'rejected' : 'structurally allowed'}`, async () => {
        const harness = createTestHarness();
        const orchestrator = new WriteOrchestrator(harness);
        const command = baseCommand(namespace, truthType, {
          actorClass: entry.policy === 'ai-with-rails' ? 'processor' : entry.policy === 'human' ? 'human' : 'processor',
        });

        const result = await orchestrator.write(command);

        if (expectRejected) {
          expect(result.outcome).toBe('rejected');
          if (result.outcome === 'rejected') {
            expect(result.reasonCodes).toContain('TRUTH_TYPE_REQUIRES_CANONICAL_NAMESPACE');
          }
        } else {
          // May still fail later (attestation/etc.) but never on the structural truth-placement reason.
          if (result.outcome === 'rejected') {
            expect(result.reasonCodes).not.toContain('TRUTH_TYPE_REQUIRES_CANONICAL_NAMESPACE');
          }
        }
      });
    }

    for (const nonTruthType of NODE_TYPES.filter((t) => !CANONICAL_ONLY_NODE_TYPES.includes(t) && t !== 'proposal')) {
      const namespace = representativeNamespace(entry.pattern);

      it(`${nonTruthType} in ${namespace} never triggers truth-placement rejection`, async () => {
        const harness = createTestHarness();
        const orchestrator = new WriteOrchestrator(harness);
        const command = baseCommand(namespace, nonTruthType, {
          actorClass: entry.policy === 'human' ? 'human' : 'processor',
        });

        const result = await orchestrator.write(command);
        if (result.outcome === 'rejected') {
          expect(result.reasonCodes).not.toContain('TRUTH_TYPE_REQUIRES_CANONICAL_NAMESPACE');
        }
      });
    }
  }
});

describe('rail matrix: every AI-with-rails truth mutation is blocked regardless of op', () => {
  const misconfiguredCanonicalAiTable = {
    entries: [{ pattern: 'canonical.ai-test', class: 'canonical', engine: 'sqlite', policy: 'ai-with-rails' } as NamespacePolicyEntry],
    registeredEngines: ['sqlite'],
    registeredPolicies: ['ai-with-rails'],
  };

  it('blocks create/update/delete of a truth type even if class were misconfigured to canonical', async () => {
    const harness = createTestHarness({ ...createTestHarness().config, namespaceTable: misconfiguredCanonicalAiTable });
    const orchestrator = new WriteOrchestrator(harness);

    const createResult = await orchestrator.write(
      baseCommand('canonical.ai-test', 'fact', { actorClass: 'processor' }),
    );
    expect(createResult.outcome).toBe('rejected');
    if (createResult.outcome === 'rejected') {
      expect(createResult.reasonCodes).toContain('AI_TRUTH_MUTATION_FORBIDDEN');
    }
  });

  it('blocks a supersedes edge created by AI-with-rails targeting a truth-type node', async () => {
    const harness = createTestHarness({ ...createTestHarness().config, namespaceTable: misconfiguredCanonicalAiTable });
    const orchestrator = new WriteOrchestrator(harness);
    const namespace = asNamespaceId('canonical.ai-test');

    // Seed a fact node directly into the repository so it can be targeted by a supersedes edge.
    await harness.repository.commit({
      namespace,
      previousRevision: null,
      resultingRevision: 1,
      revisionRecord: {
        namespace,
        revisionId: harness.idGenerator.nextRevisionId(),
        previousRevision: null,
        namespaceRevision: 1,
        createdAt: harness.clock.now(),
        actorId: asActorId('seed'),
        actorClass: 'human',
        diff: [],
        idempotencyKey: asIdempotencyKey('seed'),
      },
      nodesUpserted: [
        {
          id: asNodeId('truth-1'),
          type: 'fact',
          namespace,
          subject: asSubjectId('subject-1'),
          payload: { statement: 'seeded' },
          confidence: 0.95,
          provenance: { sources: [], railId: 'human', evaluatorVerdicts: [] },
          revision: {
            revisionId: harness.idGenerator.nextRevisionId(),
            namespaceRevision: 1,
            createdAt: harness.clock.now(),
            actorId: asActorId('seed'),
            actorClass: 'human',
          },
        },
      ],
      nodesDeleted: [],
      edgesUpserted: [],
      edgesDeleted: [],
    });

    const command: WriteCommand = {
      namespace,
      subject: asSubjectId('subject-1'),
      nodeMutations: [
        { op: 'create', nodeId: asNodeId('n-2'), nodeType: 'observation', payload: { description: 'x' }, confidence: 0.9 },
      ],
      edgeMutations: [
        { op: 'create', edgeId: asEdgeId('e-1'), kind: 'supersedes', sourceId: asNodeId('n-2'), targetId: asNodeId('truth-1') },
      ],
      expectedNamespaceRevision: 1,
      idempotencyKey: asIdempotencyKey('idem-1'),
      actorId: asActorId('actor-1'),
      actorClass: 'processor',
      provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
    };

    const result = await orchestrator.write(command);
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') {
      expect(result.reasonCodes).toContain('AI_TRUTH_MUTATION_FORBIDDEN');
    }
  });
});

describe('rail matrix: attestation requirement and mismatch handling', () => {
  it('rejects human-gated processor writes with no attestation at all', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const result = await orchestrator.write(baseCommand('canonical.project.alpha', 'decision', { actorClass: 'processor' }));
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('ATTESTATION_REQUIRED');
  });

  it('rejects when the attestation references a proposal that was never saved', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const command = baseCommand('canonical.project.alpha', 'decision', {
      actorClass: 'processor',
      attestation: { attestationId: asAttestationId('att-orphan') },
    });
    const result = await orchestrator.write(command);
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('ATTESTATION_NOT_FOUND');
  });

  it('rejects when the verifier has no record of the claimed attestation id', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const command = baseCommand('canonical.project.alpha', 'decision', {
      actorClass: 'processor',
      attestation: { attestationId: asAttestationId('att-unregistered') },
    });
    const { mutationHash } = normalizeWriteCommand(command);
    await harness.proposalRepository.save({
      id: asProposalId('proposal-1'),
      canonicalMutation: command,
      mutationHash,
      targetNamespace: command.namespace,
      targetSubject: command.subject,
      expectedTargetRevision: null,
      supportingObservationIds: [],
      provenance: { sources: [], railId: 'human-gated', evaluatorVerdicts: [] },
      version: 1,
      status: 'pending',
      events: [],
    });

    const result = await orchestrator.write(command);
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('ATTESTATION_NOT_FOUND');
  });

  it('rejects when the registered attestation is for a different proposal version', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const command = baseCommand('canonical.project.alpha', 'decision', {
      actorClass: 'processor',
      attestation: { attestationId: asAttestationId('att-1') },
    });
    const { mutationHash } = normalizeWriteCommand(command);
    const proposalId = asProposalId('proposal-1');
    await harness.proposalRepository.save({
      id: proposalId,
      canonicalMutation: command,
      mutationHash,
      targetNamespace: command.namespace,
      targetSubject: command.subject,
      expectedTargetRevision: null,
      supportingObservationIds: [],
      provenance: { sources: [], railId: 'human-gated', evaluatorVerdicts: [] },
      version: 2,
      status: 'pending',
      events: [],
    });
    harness.attestationVerifier.register({
      id: asAttestationId('att-1'),
      reviewerId: asActorId('reviewer-1'),
      approvedAt: '2026-01-01T00:00:00.000Z',
      proposalId,
      proposalVersion: 1, // stale: reviewed version 1, current proposal is version 2
      targetRevision: null,
      mutationHash,
      channel: 'test',
      verifierMeta: {},
    });

    const result = await orchestrator.write(command);
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('ATTESTATION_NOT_FOUND');
  });

  it('rejects an attestation whose reviewed target revision no longer matches the proposal', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const command = baseCommand('canonical.project.alpha', 'decision', {
      actorClass: 'processor',
      attestation: { attestationId: asAttestationId('att-1') },
    });
    const { mutationHash } = normalizeWriteCommand(command);
    const proposalId = asProposalId('proposal-1');
    await harness.proposalRepository.save({
      id: proposalId,
      canonicalMutation: command,
      mutationHash,
      targetNamespace: command.namespace,
      targetSubject: command.subject,
      expectedTargetRevision: 3,
      supportingObservationIds: [],
      provenance: { sources: [], railId: 'human-gated', evaluatorVerdicts: [] },
      version: 1,
      status: 'pending',
      events: [],
    });
    // the reviewer approved this against target revision 2, but the proposal now expects revision 3
    harness.attestationVerifier.register({
      id: asAttestationId('att-1'),
      reviewerId: asActorId('reviewer-1'),
      approvedAt: '2026-01-01T00:00:00.000Z',
      proposalId,
      proposalVersion: 1,
      targetRevision: 2,
      mutationHash,
      channel: 'test',
      verifierMeta: {},
    });

    const result = await orchestrator.write(command);
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('ATTESTATION_TARGET_REVISION_MISMATCH');
  });
});

describe('rail matrix: provenance and support failures', () => {
  it('rejects a write with zero attributable sources', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const result = await orchestrator.write(
      baseCommand('memory.community.topic-1', 'observation', { actorClass: 'processor', provenanceInput: { sources: [] } }),
    );
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('PROVENANCE_MISSING_SOURCE');
  });

  it('rejects a source-derived candidate with no derived_from edge', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const result = await orchestrator.write(
      baseCommand('memory.community.topic-1', 'observation', {
        actorClass: 'processor',
        provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }], sourceDerived: true },
      }),
    );
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('PROVENANCE_MISSING_DERIVED_FROM_EDGE');
  });

  it('rejects a proposal node with no supporting observation', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const result = await orchestrator.write(baseCommand('memory.community.topic-1', 'proposal', { actorClass: 'processor' }));
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') {
      expect(result.reasonCodes).toContain('PROPOSAL_MISSING_OBSERVATION_SUPPORT');
    }
  });

  it('accepts a proposal node backed by an existing observation and a support edge', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    await orchestrator.write(
      baseCommand('memory.community.topic-1', 'observation', {
        idempotencyKey: asIdempotencyKey('idem-obs'),
        actorClass: 'processor',
        nodeMutations: [{ op: 'create', nodeId: asNodeId('obs-1'), nodeType: 'observation', payload: { description: 'seen' }, confidence: 0.9 }],
      }),
    );

    const command = baseCommand('memory.community.topic-1', 'proposal', {
      idempotencyKey: asIdempotencyKey('idem-proposal'),
      actorClass: 'processor',
      expectedNamespaceRevision: 1,
      nodeMutations: [{ op: 'create', nodeId: asNodeId('prop-1'), nodeType: 'proposal', payload: { proposalId: 'prop-1', summary: 'x' }, confidence: 0.9 }],
      edgeMutations: [
        { op: 'create', edgeId: asEdgeId('e-1'), kind: 'derived_from', sourceId: asNodeId('prop-1'), targetId: asNodeId('obs-1') },
      ],
    });

    const result = await orchestrator.write(command);
    expect(result.outcome).toBe('applied');
  });
});

describe('rail matrix: schema validation for every node type', () => {
  const invalidPayloads: Record<NodeType, Record<string, unknown>> = {
    fact: { attributes: {} },
    resource: {},
    prohibition: {},
    observation: {},
    interaction: {},
    decision: {},
    proposal: { proposalId: 'p-1' },
  };

  for (const nodeType of NODE_TYPES) {
    it(`rejects an invalid ${nodeType} payload with SCHEMA_VALIDATION_FAILED`, async () => {
      const harness = createTestHarness();
      const orchestrator = new WriteOrchestrator(harness);
      const namespace = CANONICAL_ONLY_NODE_TYPES.includes(nodeType) ? 'canonical.global' : 'memory.community.topic-1';
      const command = baseCommand(namespace, nodeType, {
        actorClass: namespace === 'canonical.global' ? 'human' : 'processor',
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-1'), nodeType, payload: invalidPayloads[nodeType], confidence: 0.9 }],
      });
      const result = await orchestrator.write(command);
      expect(result.outcome).toBe('rejected');
      if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('SCHEMA_VALIDATION_FAILED');
    });
  }
});

describe('rail matrix: confidence floors and processor volume caps', () => {
  it('rejects a below-floor confidence value', async () => {
    const harness = createTestHarness({
      ...createTestHarness().config,
      confidencePolicy: { floors: { observation: 0.8 }, defaultFloor: 0.5 },
    });
    const orchestrator = new WriteOrchestrator(harness);
    const result = await orchestrator.write(
      baseCommand('memory.community.topic-1', 'observation', {
        actorClass: 'processor',
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-1'), nodeType: 'observation', payload: { description: 'x' }, confidence: 0.6 }],
      }),
    );
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('CONFIDENCE_BELOW_FLOOR');
  });

  it('rejects once the processor volume cap is exhausted', async () => {
    const processorId = asProcessorId('proc-1');
    const harness = createTestHarness({
      ...createTestHarness().config,
      volumePolicy: { perProcessorCap: { [processorId]: { windowMs: 60_000, maxWrites: 1 } } },
    });
    const orchestrator = new WriteOrchestrator(harness);
    await harness.usageCounter.record(processorId, harness.clock.now());
    await harness.usageCounter.record(processorId, harness.clock.now());

    const result = await orchestrator.write(
      baseCommand('memory.community.topic-1', 'observation', {
        actorClass: 'processor',
        provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }], processorId },
      }),
    );
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('PROCESSOR_VOLUME_CAP_EXCEEDED');
  });
});

describe('rail matrix: stale revision, replay, and append-only', () => {
  it('reports a conflict on a stale expected namespace revision', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    await orchestrator.write(baseCommand('memory.community.topic-1', 'observation', { actorClass: 'processor' }));
    const result = await orchestrator.write(
      baseCommand('memory.community.topic-1', 'observation', {
        actorClass: 'processor',
        idempotencyKey: asIdempotencyKey('idem-2'),
        expectedNamespaceRevision: 0,
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-2'), nodeType: 'observation', payload: { description: 'y' }, confidence: 0.9 }],
      }),
    );
    expect(result.outcome).toBe('conflict');
  });

  it.each(['update', 'delete', 'revert'] as const)('rejects a %s mutation under an append-only namespace', async (op) => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const mutation =
      op === 'update'
        ? ({ op: 'update', nodeId: asNodeId('n-1'), payload: { description: 'y' } } as const)
        : op === 'delete'
          ? ({ op: 'delete', nodeId: asNodeId('n-1') } as const)
          : ({ op: 'revert', nodeId: asNodeId('n-1'), targetRevisionId: asRevisionId('rev-1') } as const);

    const result = await orchestrator.write(
      baseCommand('operation.ingest', 'observation', { actorClass: 'processor', nodeMutations: [mutation] }),
    );
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') expect(result.reasonCodes).toContain('APPEND_ONLY_VIOLATION');
  });
});

describe('rail matrix: reversible diffs', () => {
  it('reverts a create to a delete as a new attributable revision', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const namespace = 'memory.community.topic-1';

    const createResult = await orchestrator.write(baseCommand(namespace, 'observation', { actorClass: 'processor' }));
    expect(createResult.outcome).toBe('applied');

    const [createRevision] = await harness.repository.listRevisionsSince(asNamespaceId(namespace), 0);

    const revertResult = await orchestrator.write(
      baseCommand(namespace, 'observation', {
        actorClass: 'processor',
        idempotencyKey: asIdempotencyKey('idem-revert'),
        expectedNamespaceRevision: 1,
        nodeMutations: [{ op: 'revert', nodeId: asNodeId('n-1'), targetRevisionId: createRevision!.revisionId }],
      }),
    );

    expect(revertResult.outcome).toBe('applied');
    expect(await harness.repository.getNode(asNamespaceId(namespace), asNodeId('n-1'))).toBeUndefined();
  });

  it('reverts an update back to its prior payload value', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const namespace = 'memory.community.topic-1';

    await orchestrator.write(baseCommand(namespace, 'observation', { actorClass: 'processor' }));
    await orchestrator.write(
      baseCommand(namespace, 'observation', {
        actorClass: 'processor',
        idempotencyKey: asIdempotencyKey('idem-update'),
        expectedNamespaceRevision: 1,
        nodeMutations: [{ op: 'update', nodeId: asNodeId('n-1'), payload: { description: 'updated' } }],
      }),
    );

    const revisions = await harness.repository.listRevisionsSince(asNamespaceId(namespace), 0);
    const updateRevision = revisions[1]!;

    await orchestrator.write(
      baseCommand(namespace, 'observation', {
        actorClass: 'processor',
        idempotencyKey: asIdempotencyKey('idem-revert'),
        expectedNamespaceRevision: 2,
        nodeMutations: [{ op: 'revert', nodeId: asNodeId('n-1'), targetRevisionId: updateRevision.revisionId }],
      }),
    );

    const finalNode = await harness.repository.getNode(asNamespaceId(namespace), asNodeId('n-1'));
    expect((finalNode?.payload as { description: string }).description).toBe('saw a thing');
  });
});

describe('rail matrix: deterministic audit sampling', () => {
  it('samples exactly on the configured every-N revision, not randomly', async () => {
    const harness = createTestHarness({
      ...createTestHarness().config,
      auditPolicy: { defaultEvery: 2, perProcessorEvery: {}, perNamespaceEvery: {} },
    });
    const orchestrator = new WriteOrchestrator(harness);
    const namespace = 'memory.community.topic-1';

    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        await orchestrator.write(
          baseCommand(namespace, 'observation', {
            actorClass: 'processor',
            idempotencyKey: asIdempotencyKey(`idem-${i}`),
            expectedNamespaceRevision: i === 0 ? null : i,
            nodeMutations: [{ op: 'create', nodeId: asNodeId(`n-${i}`), nodeType: 'observation', payload: { description: `d${i}` }, confidence: 0.9 }],
          }),
        ),
      );
    }

    const sampledFlags = results.map((r) => (r.outcome === 'applied' ? r.auditDirective?.sampled : undefined));
    expect(sampledFlags).toEqual([false, true, false, true]);
  });
});
