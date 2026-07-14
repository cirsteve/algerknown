import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asAttestationId,
  asEventId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asProposalId,
  asSubjectId,
  normalizeWriteCommand,
  WriteOrchestrator,
  type WriteCommand,
} from '../../src/index.js';
import { openGovernedDatabase } from '../../src/sqlite/connection.js';
import { SqliteProposalRepository } from '../../src/sqlite/proposal-repository.js';
import { createSqliteTestHarness } from './harness.js';

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

describe('SqliteProposalRepository', () => {
  function setup() {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate();
    return { conn, repo: new SqliteProposalRepository(conn.db) };
  }

  it('round-trips a saved proposal through get()', async () => {
    const { conn, repo } = setup();
    const command = commandFor();
    const { mutationHash } = normalizeWriteCommand(command);
    const proposalId = asProposalId('proposal-1');

    await repo.save({
      id: proposalId,
      canonicalMutation: command,
      mutationHash,
      targetNamespace: command.namespace,
      targetSubject: command.subject,
      expectedTargetRevision: null,
      supportingObservationIds: [asNodeId('obs-1')],
      provenance: { sources: [{ kind: 'external', id: 'src-1' }], railId: 'human', evaluatorVerdicts: [] },
      version: 1,
      status: 'pending',
      events: [{ eventId: asEventId('evt-1'), kind: 'proposed', at: '2026-01-01T00:00:00.000Z' }],
    });

    const loaded = await repo.get(proposalId);
    expect(loaded?.status).toBe('pending');
    expect(loaded?.mutationHash).toBe(mutationHash);
    expect(loaded?.supportingObservationIds).toEqual([asNodeId('obs-1')]);
    expect(loaded?.events).toHaveLength(1);
    conn.close();
  });

  it('finds a pending proposal by namespace and mutation hash but not once accepted', async () => {
    const { conn, repo } = setup();
    const command = commandFor();
    const { mutationHash } = normalizeWriteCommand(command);
    const proposalId = asProposalId('proposal-1');
    const base = {
      id: proposalId,
      canonicalMutation: command,
      mutationHash,
      targetNamespace: command.namespace,
      targetSubject: command.subject,
      expectedTargetRevision: null,
      supportingObservationIds: [],
      provenance: { sources: [], railId: 'human', evaluatorVerdicts: [] },
      events: [],
    };

    await repo.save({ ...base, version: 1, status: 'pending' });
    const found = await repo.findPendingByMutationHash(command.namespace, mutationHash);
    expect(found?.id).toBe(proposalId);

    await repo.save({ ...base, version: 1, status: 'accepted' });
    expect(await repo.findPendingByMutationHash(command.namespace, mutationHash)).toBeUndefined();
    conn.close();
  });

  it('re-saving a proposal is idempotent for already-recorded events', async () => {
    const { conn, repo } = setup();
    const command = commandFor();
    const { mutationHash } = normalizeWriteCommand(command);
    const proposalId = asProposalId('proposal-1');
    const proposal = {
      id: proposalId,
      canonicalMutation: command,
      mutationHash,
      targetNamespace: command.namespace,
      targetSubject: command.subject,
      expectedTargetRevision: null,
      supportingObservationIds: [],
      provenance: { sources: [], railId: 'human', evaluatorVerdicts: [] },
      version: 1,
      status: 'pending' as const,
      events: [{ eventId: asEventId('evt-1'), kind: 'proposed', at: '2026-01-01T00:00:00.000Z' }],
    };

    await repo.save(proposal);
    await repo.save(proposal);
    await repo.save(proposal);

    const loaded = await repo.get(proposalId);
    expect(loaded?.events).toHaveLength(1);
    conn.close();
  });

  it('returns undefined for an unknown proposal id', async () => {
    const { conn, repo } = setup();
    expect(await repo.get(asProposalId('missing'))).toBeUndefined();
    conn.close();
  });
});

describe('SqliteProposalRepository via WriteOrchestrator', () => {
  it('routes a contradicting candidate to a durable proposal that survives a reload', async () => {
    const harness = createSqliteTestHarness();
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
      const saved = await harness.proposalRepository.get(result.proposalId);
      expect(saved?.status).toBe('pending');
    }
    harness.connection.close();
  });

  it('applies a human-policy write once a matching pending proposal and attestation are present', async () => {
    const harness = createSqliteTestHarness();
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
    harness.connection.close();
  });
});
