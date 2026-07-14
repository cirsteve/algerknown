import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asAttestationId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asProcessorId,
  asProposalId,
  asSubjectId,
  normalizeWriteCommand,
  WriteOrchestrator,
  type WriteCommand,
} from '../../src/index.js';
import { createTestHarness } from '../fixtures/deps.js';

function commandFor(overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: asNamespaceId('memory.community.topic-1'),
    subject: asSubjectId('subject-1'),
    nodeMutations: [
      { op: 'create', nodeId: asNodeId('n-1'), nodeType: 'observation', payload: { description: 'saw a thing' }, confidence: 0.7 },
    ],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey('idem-1'),
    actorId: asActorId('actor-1'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
    ...overrides,
  };
}

describe('WriteOrchestrator: AI-with-rails happy path', () => {
  it('applies an eligible non-truth mutation and mints revision 1', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    const result = await orchestrator.write(commandFor());

    expect(result.outcome).toBe('applied');
    if (result.outcome === 'applied') {
      expect(result.previousRevision).toBeNull();
      expect(result.resultingRevision).toBe(1);
      expect(result.diff).toHaveLength(1);
      expect(result.auditDirective).toBeDefined();
    }

    const stored = await harness.repository.getNode(asNamespaceId('memory.community.topic-1'), asNodeId('n-1'));
    expect(stored?.payload).toEqual({ description: 'saw a thing' });
  });

  it('records processor usage on a successful write so volume caps can actually bite', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const processorId = asProcessorId('proc-1');

    const before = await harness.usageCounter.countInWindow(processorId, 60_000, harness.clock.now());
    expect(before).toBe(0);

    await orchestrator.write(
      commandFor({ provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }], processorId } }),
    );

    const after = await harness.usageCounter.countInWindow(processorId, 60_000, harness.clock.now());
    expect(after).toBe(1);
  });

  it('replays an identical idempotency key instead of re-applying', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const command = commandFor();

    const first = await orchestrator.write(command);
    const second = await orchestrator.write(command);

    expect(second.outcome).toBe('idempotent_replay');
    if (second.outcome === 'idempotent_replay' && first.outcome === 'applied') {
      expect(second.original.resultingRevision).toBe(first.resultingRevision);
    }
    expect(await harness.repository.getNamespaceRevision(asNamespaceId('memory.community.topic-1'))).toBe(1);
  });

  it('rejects a stale expected namespace revision as a conflict', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    await orchestrator.write(commandFor());

    const result = await orchestrator.write(
      commandFor({ idempotencyKey: asIdempotencyKey('idem-2'), expectedNamespaceRevision: 0, nodeMutations: [
        { op: 'create', nodeId: asNodeId('n-2'), nodeType: 'observation', payload: { description: 'another' }, confidence: 0.7 },
      ] }),
    );

    expect(result.outcome).toBe('conflict');
    if (result.outcome === 'conflict') {
      expect(result.expectedRevision).toBe(0);
      expect(result.actualRevision).toBe(1);
    }
  });
});

describe('WriteOrchestrator: structural truth protection end-to-end', () => {
  it('rejects a fact placed in a non-canonical AI-with-rails namespace', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    const result = await orchestrator.write(
      commandFor({
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'x' }, confidence: 0.9 }],
      }),
    );

    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') {
      expect(result.reasonCodes).toContain('TRUTH_TYPE_REQUIRES_CANONICAL_NAMESPACE');
    }
  });
});

describe('WriteOrchestrator: human policy attestation binding', () => {
  it('rejects a human-policy write with no attestation', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    const command = commandFor({
      namespace: asNamespaceId('canonical.global'),
      actorClass: 'human',
      nodeMutations: [{ op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'the sky is blue' }, confidence: 0.9 }],
    });

    const result = await orchestrator.write(command);
    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') {
      expect(result.reasonCodes).toContain('ATTESTATION_REQUIRED');
    }
  });

  it('applies once a matching pending proposal and verified attestation are present', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    const command = commandFor({
      namespace: asNamespaceId('canonical.global'),
      actorClass: 'human',
      nodeMutations: [{ op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'the sky is blue' }, confidence: 0.9 }],
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
      provenance: { sources: [], railId: 'human', evaluatorVerdicts: [] },
      version: 1,
      status: 'pending',
      events: [],
    });
    harness.attestationVerifier.register({
      id: asAttestationId('att-1'),
      reviewerId: asActorId('reviewer-1'),
      approvedAt: '2026-01-01T00:00:00.000Z',
      proposalId,
      proposalVersion: 1,
      targetRevision: null,
      mutationHash,
      channel: 'test',
      verifierMeta: {},
    });

    const result = await orchestrator.write(command);
    expect(result.outcome).toBe('applied');
  });
});

describe('WriteOrchestrator: contradiction routing', () => {
  it('routes a contradicting lower-confidence candidate to a proposal instead of applying it', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    await orchestrator.write(
      commandFor({
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-existing'), nodeType: 'observation', payload: { description: 'first' }, confidence: 0.9 }],
      }),
    );

    harness.contradictionDetector.setMatches([{ nodeId: asNodeId('n-existing') }]);

    const result = await orchestrator.write(
      commandFor({
        idempotencyKey: asIdempotencyKey('idem-2'),
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-new'), nodeType: 'observation', payload: { description: 'conflicting' }, confidence: 0.5 }],
      }),
    );

    expect(result.outcome).toBe('routed_to_proposal');
    if (result.outcome === 'routed_to_proposal') {
      expect(result.reasonCodes).toContain('CONTRADICTION_DETECTED');
      const saved = await harness.proposalRepository.get(result.proposalId);
      expect(saved?.canonicalMutation.edgeMutations.some((m) => m.op === 'create' && m.kind === 'contradicts')).toBe(true);
    }
    expect(await harness.repository.getNode(asNamespaceId('memory.community.topic-1'), asNodeId('n-new'))).toBeUndefined();
  });
});

describe('WriteOrchestrator: append-only enforcement', () => {
  it('rejects an update mutation under an append-only namespace', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    const result = await orchestrator.write(
      commandFor({
        namespace: asNamespaceId('operation.ingest'),
        nodeMutations: [{ op: 'update', nodeId: asNodeId('n-1'), payload: { description: 'x' } }],
      }),
    );

    expect(result.outcome).toBe('rejected');
    if (result.outcome === 'rejected') {
      expect(result.reasonCodes).toContain('APPEND_ONLY_VIOLATION');
    }
  });

  it('records an operation-sink entry for an applied append-only write', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    await orchestrator.write(
      commandFor({
        namespace: asNamespaceId('operation.ingest'),
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-1'), nodeType: 'observation', payload: { description: 'logged' }, confidence: 0.7 }],
      }),
    );

    expect(harness.operationSink.records).toHaveLength(1);
  });
});
