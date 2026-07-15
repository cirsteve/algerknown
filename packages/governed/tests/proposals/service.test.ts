import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asAttestationId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asSubjectId,
  normalizeWriteCommand,
  type WriteCommand,
} from '../../src/index.js';
import {
  ProposalIdempotencyMismatchError,
  ProposalInvalidTransitionError,
  ProposalValidationError,
  ProposalVersionConflictError,
} from '../../src/proposals/errors.js';
import { createProposalsTestHarness } from './harness.js';

const CANONICAL_NAMESPACE = asNamespaceId('canonical.global');

function factMutation(overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: CANONICAL_NAMESPACE,
    subject: asSubjectId('subject-1'),
    nodeMutations: [
      { op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'the sky is blue' }, confidence: 0.9 },
    ],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey('write-idem-1'),
    actorId: asActorId('actor-1'),
    actorClass: 'human',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
    ...overrides,
  };
}

function registerAttestationFor(
  harness: ReturnType<typeof createProposalsTestHarness>,
  params: {
    attestationId: string;
    proposalId: string;
    proposalVersion: number;
    mutationHash: string;
    targetRevision: number | null;
  },
) {
  harness.attestationVerifier.register({
    id: asAttestationId(params.attestationId),
    reviewerId: asActorId('reviewer-1'),
    approvedAt: harness.clock.now(),
    proposalId: params.proposalId as never,
    proposalVersion: params.proposalVersion,
    targetRevision: params.targetRevision,
    mutationHash: params.mutationHash as never,
    channel: 'test',
    verifierMeta: {},
  });
}

describe('DurableProposalService: propose and inspect', () => {
  it('creates a pending proposal and records a proposed event', async () => {
    const harness = createProposalsTestHarness();
    const outcome = await harness.service.propose({
      mutation: factMutation(),
      supportingObservationIds: [],
      idempotencyKey: 'propose-1',
    });

    expect(outcome.outcome).toBe('created');
    if (outcome.outcome !== 'created') throw new Error('unreachable');
    expect(outcome.proposal.status).toBe('pending');
    expect(outcome.proposal.version).toBe(1);

    const inspection = await harness.service.inspect(outcome.proposal.id);
    expect(inspection.events.map((e) => e.kind)).toEqual(['proposed']);
    expect(inspection.currentVersion.canonicalMutation.namespace).toBe(CANONICAL_NAMESPACE);
    harness.connection.close();
  });

  it('replays an identical propose call under the same idempotency key', async () => {
    const harness = createProposalsTestHarness();
    const input = { mutation: factMutation(), supportingObservationIds: [], idempotencyKey: 'propose-1' };
    const first = await harness.service.propose(input);
    const second = await harness.service.propose(input);

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('created');
    if (first.outcome === 'created' && second.outcome === 'created') {
      expect(second.proposal.id).toBe(first.proposal.id);
    }
    harness.connection.close();
  });

  it('rejects a reused propose idempotency key with different content', async () => {
    const harness = createProposalsTestHarness();
    await harness.service.propose({ mutation: factMutation(), supportingObservationIds: [], idempotencyKey: 'propose-1' });

    await expect(
      harness.service.propose({
        mutation: factMutation({ nodeMutations: [{ op: 'create', nodeId: asNodeId('n-2'), nodeType: 'fact', payload: { statement: 'different' }, confidence: 0.9 }] }),
        supportingObservationIds: [],
        idempotencyKey: 'propose-1',
      }),
    ).rejects.toThrow(ProposalIdempotencyMismatchError);
    harness.connection.close();
  });
});

describe('DurableProposalService: amend', () => {
  it('creates a new version and records an amended event', async () => {
    const harness = createProposalsTestHarness();
    const created = await harness.service.propose({ mutation: factMutation(), supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');

    const amended = await harness.service.amend(created.proposal.id, {
      expectedVersion: 1,
      mutation: factMutation({
        idempotencyKey: asIdempotencyKey('write-idem-2'),
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'the sky is blue-ish' }, confidence: 0.9 }],
      }),
      supportingObservationIds: [],
      actorId: asActorId('reviewer-1'),
      channel: 'cli',
      note: 'Clarify the phrasing.',
      idempotencyKey: 'amend-1',
    });

    expect(amended.version).toBe(2);
    const inspection = await harness.service.inspect(created.proposal.id);
    expect(inspection.events.map((e) => e.kind)).toEqual(['proposed', 'amended']);
    expect(inspection.events[1]).toMatchObject({ actorId: 'reviewer-1', channel: 'cli', note: 'Clarify the phrasing.' });
    expect(inspection.currentVersion.canonicalMutation.nodeMutations[0]).toMatchObject({ payload: { statement: 'the sky is blue-ish' } });
    harness.connection.close();
  });

  it('rejects amend with a stale expected version', async () => {
    const harness = createProposalsTestHarness();
    const created = await harness.service.propose({ mutation: factMutation(), supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');

    await expect(
      harness.service.amend(created.proposal.id, {
        expectedVersion: 99,
        mutation: factMutation({ idempotencyKey: asIdempotencyKey('write-idem-2') }),
        supportingObservationIds: [],
        idempotencyKey: 'amend-1',
      }),
    ).rejects.toThrow(ProposalVersionConflictError);
    harness.connection.close();
  });
});

describe('DurableProposalService: accept', () => {
  it('applies the write once a matching attestation is verified, and records the attestation', async () => {
    const harness = createProposalsTestHarness();
    const command = factMutation();
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');

    const { mutationHash } = normalizeWriteCommand(command);
    await registerAttestationFor(harness, {
      attestationId: 'att-1',
      proposalId: created.proposal.id,
      proposalVersion: 1,
      mutationHash,
      targetRevision: null,
    });

    const result = await harness.service.accept(created.proposal.id, {
      expectedVersion: 1,
      expectedTargetRevision: null,
      attestationId: asAttestationId('att-1'),
      actorId: asActorId('reviewer-1'),
      channel: 'test',
      idempotencyKey: 'accept-1',
    });

    expect(result.outcome).toBe('accepted');
    if (result.outcome === 'accepted') {
      expect(result.resultingRevision).toBe(1);
    }
    const proposal = await harness.service.getProposal(created.proposal.id);
    expect(proposal?.status).toBe('accepted');
    expect(proposal?.resultingRevision).toBe(1);

    const attestationRow = harness.connection.db.prepare('SELECT * FROM attestations WHERE proposal_id = ?').get(created.proposal.id);
    expect(attestationRow).toBeTruthy();
    harness.connection.close();
  });

  it('rolls back the namespace write when proposal finalization fails', async () => {
    const harness = createProposalsTestHarness();
    const command = factMutation();
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');

    const { mutationHash } = normalizeWriteCommand(command);
    await registerAttestationFor(harness, {
      attestationId: 'att-1',
      proposalId: created.proposal.id,
      proposalVersion: 1,
      mutationHash,
      targetRevision: null,
    });

    harness.connection.db.exec(`
      CREATE TRIGGER fail_attestation_finalize
      BEFORE INSERT ON attestations
      BEGIN
        SELECT RAISE(ABORT, 'injected proposal-finalization failure');
      END;
    `);

    await expect(
      harness.service.accept(created.proposal.id, {
        expectedVersion: 1,
        expectedTargetRevision: null,
        attestationId: asAttestationId('att-1'),
        actorId: asActorId('reviewer-1'),
        channel: 'test',
        idempotencyKey: 'accept-1',
      }),
    ).rejects.toThrow('injected proposal-finalization failure');

    expect(await harness.repository.getNamespaceRevision(CANONICAL_NAMESPACE)).toBeNull();
    expect(await harness.repository.getNode(CANONICAL_NAMESPACE, asNodeId('n-1'))).toBeUndefined();
    expect((await harness.service.getProposal(created.proposal.id))?.status).toBe('pending');
    expect(
      harness.connection.db
        .prepare(`SELECT COUNT(*) AS count FROM idempotency_records WHERE scope = 'proposal.accept'`)
        .get(),
    ).toEqual({ count: 0 });
    expect((await harness.service.inspect(created.proposal.id)).events.map((event) => event.kind)).toEqual(['proposed']);
    harness.connection.close();
  });

  it('records a version conflict and leaves the proposal pending on a stale expected version', async () => {
    const harness = createProposalsTestHarness();
    const command = factMutation();
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');

    await harness.service.amend(created.proposal.id, {
      expectedVersion: 1,
      mutation: factMutation({ idempotencyKey: asIdempotencyKey('write-idem-2') }),
      supportingObservationIds: [],
      idempotencyKey: 'amend-1',
    });

    const { mutationHash } = normalizeWriteCommand(command);
    await registerAttestationFor(harness, { attestationId: 'att-1', proposalId: created.proposal.id, proposalVersion: 1, mutationHash, targetRevision: null });

    const result = await harness.service.accept(created.proposal.id, {
      expectedVersion: 1, // stale: proposal is now at version 2
      expectedTargetRevision: null,
      attestationId: asAttestationId('att-1'),
      actorId: asActorId('reviewer-1'),
      channel: 'test',
      idempotencyKey: 'accept-1',
    });

    expect(result.outcome).toBe('version_conflict');
    const proposal = await harness.service.getProposal(created.proposal.id);
    expect(proposal?.status).toBe('pending');
    const inspection = await harness.service.inspect(created.proposal.id);
    expect(inspection.events.some((e) => e.kind === 'accept_conflict')).toBe(true);
    harness.connection.close();
  });

  it('records a target revision conflict when the namespace advanced since the proposal was made', async () => {
    const harness = createProposalsTestHarness();

    // Bump the namespace to revision 1 with an unrelated write first.
    const bump = factMutation({ nodeMutations: [{ op: 'create', nodeId: asNodeId('n-bump'), nodeType: 'fact', payload: { statement: 'bump' }, confidence: 0.9 }] });
    const bumpCreated = await harness.service.propose({ mutation: bump, supportingObservationIds: [], idempotencyKey: 'propose-bump' });
    if (bumpCreated.outcome !== 'created') throw new Error('unreachable');
    const { mutationHash: bumpHash } = normalizeWriteCommand(bump);
    await registerAttestationFor(harness, { attestationId: 'att-bump', proposalId: bumpCreated.proposal.id, proposalVersion: 1, mutationHash: bumpHash, targetRevision: null });
    await harness.service.accept(bumpCreated.proposal.id, {
      expectedVersion: 1,
      expectedTargetRevision: null,
      attestationId: asAttestationId('att-bump'),
      actorId: asActorId('reviewer-1'),
      channel: 'test',
      idempotencyKey: 'accept-bump',
    });

    const command = factMutation({ idempotencyKey: asIdempotencyKey('write-idem-2') });
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');
    const { mutationHash } = normalizeWriteCommand(command);
    await registerAttestationFor(harness, { attestationId: 'att-1', proposalId: created.proposal.id, proposalVersion: 1, mutationHash, targetRevision: 0 });

    const result = await harness.service.accept(created.proposal.id, {
      expectedVersion: 1,
      expectedTargetRevision: 0, // stale: namespace is now at revision 1
      attestationId: asAttestationId('att-1'),
      actorId: asActorId('reviewer-1'),
      channel: 'test',
      idempotencyKey: 'accept-1',
    });

    expect(result.outcome).toBe('target_revision_conflict');
    if (result.outcome === 'target_revision_conflict') {
      expect(result.actualRevision).toBe(1);
    }
    const proposal = await harness.service.getProposal(created.proposal.id);
    expect(proposal?.status).toBe('pending');
    harness.connection.close();
  });
});

describe('DurableProposalService: reject, expire, delete', () => {
  it('rejects a pending proposal with a reason and blocks a further transition', async () => {
    const harness = createProposalsTestHarness();
    const created = await harness.service.propose({ mutation: factMutation(), supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');

    const rejected = await harness.service.reject(created.proposal.id, {
      expectedVersion: 1,
      actorId: asActorId('reviewer-1'),
      reason: 'not credible',
      idempotencyKey: 'reject-1',
    });
    expect(rejected.status).toBe('rejected');

    await expect(
      harness.service.reject(created.proposal.id, { expectedVersion: 1, actorId: asActorId('reviewer-1'), reason: 'again', idempotencyKey: 'reject-2' }),
    ).rejects.toThrow(ProposalInvalidTransitionError);
    harness.connection.close();
  });

  it('rejects an empty reject reason', async () => {
    const harness = createProposalsTestHarness();
    const created = await harness.service.propose({ mutation: factMutation(), supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');

    await expect(
      harness.service.reject(created.proposal.id, { expectedVersion: 1, actorId: asActorId('reviewer-1'), reason: '   ', idempotencyKey: 'reject-1' }),
    ).rejects.toThrow(ProposalValidationError);
    harness.connection.close();
  });

  it('expires a pending proposal with a note', async () => {
    const harness = createProposalsTestHarness();
    const created = await harness.service.propose({ mutation: factMutation(), supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');

    const expired = await harness.service.expire(created.proposal.id, { expectedVersion: 1, note: 'stale evidence', idempotencyKey: 'expire-1' });
    expect(expired.status).toBe('expired');
    harness.connection.close();
  });

  it('tombstones a proposal from any non-deleted status without removing its history', async () => {
    const harness = createProposalsTestHarness();
    const created = await harness.service.propose({ mutation: factMutation(), supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');

    const deleted = await harness.service.delete(created.proposal.id, { expectedVersion: 1, actorId: asActorId('reviewer-1'), reason: 'duplicate', idempotencyKey: 'delete-1' });
    expect(deleted.status).toBe('deleted');

    const inspection = await harness.service.inspect(created.proposal.id);
    expect(inspection.events.map((e) => e.kind)).toEqual(['proposed', 'deleted']);

    await expect(
      harness.service.delete(created.proposal.id, { expectedVersion: 1, actorId: asActorId('reviewer-1'), reason: 'again', idempotencyKey: 'delete-2' }),
    ).rejects.toThrow(ProposalInvalidTransitionError);
    harness.connection.close();
  });
});

describe('DurableProposalService: identical-candidate suppression', () => {
  it('suppresses a re-proposed candidate matching a prior rejected fingerprint and unchanged mutation', async () => {
    const harness = createProposalsTestHarness();
    const command = factMutation();
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');
    await harness.service.reject(created.proposal.id, { expectedVersion: 1, actorId: asActorId('reviewer-1'), reason: 'not credible', idempotencyKey: 'reject-1' });

    const retried = await harness.service.propose({
      mutation: factMutation({ idempotencyKey: asIdempotencyKey('write-idem-2') }),
      supportingObservationIds: [],
      idempotencyKey: 'propose-2',
    });

    expect(retried.outcome).toBe('suppressed');
    if (retried.outcome === 'suppressed') {
      expect(retried.priorProposalId).toBe(created.proposal.id);
      expect(retried.reason).toBe('not credible');
    }
    harness.connection.close();
  });

  it('does not suppress a materially different mutation even at the same fingerprint namespace/subject', async () => {
    const harness = createProposalsTestHarness();
    const command = factMutation();
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');
    await harness.service.reject(created.proposal.id, { expectedVersion: 1, actorId: asActorId('reviewer-1'), reason: 'not credible', idempotencyKey: 'reject-1' });

    const different = await harness.service.propose({
      mutation: factMutation({
        idempotencyKey: asIdempotencyKey('write-idem-2'),
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-1'), nodeType: 'fact', payload: { statement: 'a completely different claim' }, confidence: 0.9 }],
      }),
      supportingObservationIds: [],
      idempotencyKey: 'propose-2',
    });

    expect(different.outcome).toBe('created');
    harness.connection.close();
  });
});

const AI_NAMESPACE = asNamespaceId('memory.community.topic-1');

function observationMutation(overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: AI_NAMESPACE,
    subject: asSubjectId('subject-1'),
    nodeMutations: [
      { op: 'create', nodeId: asNodeId('n-1'), nodeType: 'observation', payload: { description: 'saw a thing' }, confidence: 0.7 },
    ],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey('write-idem-1'),
    actorId: asActorId('actor-1'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
    ...overrides,
  };
}

async function acceptViaService(
  harness: ReturnType<typeof createProposalsTestHarness>,
  proposalId: string,
  mutationHash: string,
  idempotencyKey: string,
) {
  registerAttestationFor(harness, { attestationId: `att-${idempotencyKey}`, proposalId, proposalVersion: 1, mutationHash, targetRevision: null });
  return harness.service.accept(proposalId as never, {
    expectedVersion: 1,
    expectedTargetRevision: null,
    attestationId: asAttestationId(`att-${idempotencyKey}`),
    actorId: asActorId('reviewer-1'),
    channel: 'test',
    idempotencyKey,
  });
}

describe('DurableProposalService: revert', () => {
  it('reverts directly (no attestation cycle) on a namespace that permits direct mutation', async () => {
    const harness = createProposalsTestHarness();
    const command = observationMutation();
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');
    const { mutationHash } = normalizeWriteCommand(command);
    await acceptViaService(harness, created.proposal.id, mutationHash, 'accept-1');

    expect(await harness.repository.getNode(AI_NAMESPACE, asNodeId('n-1'))).toBeDefined();

    const reverted = await harness.service.revert(created.proposal.id, {
      actorId: asActorId('reviewer-1'),
      actorClass: 'processor',
      reason: 'incorrect after all',
      channel: 'test',
      idempotencyKey: 'revert-1',
    });

    expect(reverted.outcome).toBe('reverted');
    expect(await harness.repository.getNode(AI_NAMESPACE, asNodeId('n-1'))).toBeUndefined();

    const proposal = await harness.service.getProposal(created.proposal.id);
    expect(proposal?.status).toBe('accepted');
    expect(proposal?.reverted).toBe(true);

    const reversalRow = harness.connection.db.prepare('SELECT * FROM reversals WHERE proposal_id = ?').get(created.proposal.id) as
      | { original_revision: number; new_revision: number }
      | undefined;
    expect(reversalRow).toBeTruthy();
    expect(reversalRow!.new_revision).toBeGreaterThan(reversalRow!.original_revision);

    await expect(
      harness.service.revert(created.proposal.id, { actorId: asActorId('reviewer-1'), actorClass: 'processor', reason: 'again', idempotencyKey: 'revert-2' }),
    ).rejects.toThrow(ProposalInvalidTransitionError);
    harness.connection.close();
  });

  it('two concurrent revert calls with the same idempotency key converge on one reversal, not a raw constraint error', async () => {
    const harness = createProposalsTestHarness();
    const command = observationMutation();
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-concurrent' });
    if (created.outcome !== 'created') throw new Error('unreachable');
    const { mutationHash } = normalizeWriteCommand(command);
    await acceptViaService(harness, created.proposal.id, mutationHash, 'accept-concurrent');

    const revertInput = {
      actorId: asActorId('reviewer-1'),
      actorClass: 'processor' as const,
      reason: 'concurrent revert race',
      channel: 'test',
      idempotencyKey: 'revert-concurrent',
    };

    const [first, second] = await Promise.all([
      harness.service.revert(created.proposal.id, revertInput),
      harness.service.revert(created.proposal.id, revertInput),
    ]);

    expect(first).toEqual(second);
    expect(first.outcome).toBe('reverted');

    const reversalRows = harness.connection.db.prepare('SELECT * FROM reversals WHERE proposal_id = ?').all(created.proposal.id);
    expect(reversalRows).toHaveLength(1);

    harness.connection.close();
  });

  it('reverts via a two-phase proposeRevert + attested revert on a namespace that requires attestation', async () => {
    const harness = createProposalsTestHarness();
    const command = factMutation();
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');
    const { mutationHash } = normalizeWriteCommand(command);
    await acceptViaService(harness, created.proposal.id, mutationHash, 'accept-1');

    expect(await harness.repository.getNode(CANONICAL_NAMESPACE, asNodeId('n-1'))).toBeDefined();

    const candidate = await harness.service.proposeRevert(created.proposal.id, {
      actorId: asActorId('reviewer-1'),
      actorClass: 'human',
      idempotencyKey: 'prepare-revert-1',
    });
    expect(candidate.revertProposalId).toBeTruthy();
    const candidateBeforeAttestation = await harness.service.getProposal(candidate.revertProposalId);

    registerAttestationFor(harness, {
      attestationId: 'att-revert-1',
      proposalId: candidate.revertProposalId,
      proposalVersion: candidate.revertProposalVersion,
      mutationHash: candidate.mutationHash,
      targetRevision: candidateBeforeAttestation!.expectedTargetRevision,
    });

    const reverted = await harness.service.revert(created.proposal.id, {
      actorId: asActorId('reviewer-1'),
      actorClass: 'human',
      reason: 'incorrect after all',
      channel: 'test',
      idempotencyKey: 'revert-1',
      revertCandidateId: candidate.revertProposalId,
      attestationId: asAttestationId('att-revert-1'),
    });

    expect(reverted.outcome).toBe('reverted');
    expect(await harness.repository.getNode(CANONICAL_NAMESPACE, asNodeId('n-1'))).toBeUndefined();

    const candidateProposal = await harness.service.getProposal(candidate.revertProposalId);
    expect(candidateProposal?.status).toBe('accepted');
    harness.connection.close();
  });

  it('rejects revert with an empty reason', async () => {
    const harness = createProposalsTestHarness();
    const command = observationMutation();
    const created = await harness.service.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-1' });
    if (created.outcome !== 'created') throw new Error('unreachable');
    const { mutationHash } = normalizeWriteCommand(command);
    await acceptViaService(harness, created.proposal.id, mutationHash, 'accept-1');

    await expect(
      harness.service.revert(created.proposal.id, { actorId: asActorId('reviewer-1'), actorClass: 'processor', reason: '  ', idempotencyKey: 'revert-1' }),
    ).rejects.toThrow(ProposalValidationError);
    harness.connection.close();
  });
});
