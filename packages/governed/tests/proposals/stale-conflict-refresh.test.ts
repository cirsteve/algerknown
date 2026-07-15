import { describe, expect, it } from 'vitest';
import { asActorId, asAttestationId, asIdempotencyKey, asNamespaceId, asNodeId, asSubjectId, normalizeWriteCommand, type WriteCommand } from '../../src/index.js';
import { createProposalsTestHarness } from './harness.js';
import { recordSuiteEvidence, trackSuiteFailures } from '../acceptance/evidence-helpers.js';

const NAMESPACE = asNamespaceId('canonical.global');
const REVIEWER = asActorId('reviewer-1');

function factMutation(nodeId: string, overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: NAMESPACE,
    subject: asSubjectId('subject-stale'),
    nodeMutations: [{ op: 'create', nodeId: asNodeId(nodeId), nodeType: 'fact', payload: { statement: `Statement for ${nodeId}.` }, confidence: 0.9 }],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey(`write-${nodeId}`),
    actorId: asActorId('processor-1'),
    actorClass: 'human',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
    ...overrides,
  };
}

async function attestAndAccept(
  harness: ReturnType<typeof createProposalsTestHarness>,
  proposalId: string,
  opts: { attestationId: string; mutationHash: string; expectedVersion: number; expectedTargetRevision: number | null; idempotencyKey: string },
) {
  harness.attestationVerifier.register({
    id: asAttestationId(opts.attestationId),
    reviewerId: REVIEWER,
    approvedAt: harness.clock.now(),
    proposalId: proposalId as never,
    proposalVersion: opts.expectedVersion,
    targetRevision: opts.expectedTargetRevision,
    mutationHash: opts.mutationHash as never,
    channel: 'test',
    verifierMeta: {},
  });
  return harness.service.accept(proposalId as never, {
    expectedVersion: opts.expectedVersion,
    expectedTargetRevision: opts.expectedTargetRevision,
    attestationId: asAttestationId(opts.attestationId),
    actorId: REVIEWER,
    channel: 'test',
    idempotencyKey: opts.idempotencyKey,
  });
}

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

/**
 * INV4: two proposals race against the same namespace revision. The first
 * to be accepted wins; the second's stale expectation is detected as a
 * conflict and *never silently applied* -- it only lands after an explicit
 * refresh (a new amendment retargeting the now-current revision) and a new
 * round of human review.
 */
describe('INV4: a stale conflict never applies before new human review', () => {
  it('accepts the first proposal, detects the conflict on the second, refreshes it, and only then applies it', async () => {
    const harness = createProposalsTestHarness();

    const proposedA = await harness.service.propose({ mutation: factMutation('n-stale-a'), supportingObservationIds: [], idempotencyKey: 'propose-stale-a' });
    if (proposedA.outcome !== 'created') throw new Error('expected created');
    const proposedB = await harness.service.propose({ mutation: factMutation('n-stale-b'), supportingObservationIds: [], idempotencyKey: 'propose-stale-b' });
    if (proposedB.outcome !== 'created') throw new Error('expected created');

    const { mutationHash: hashA } = normalizeWriteCommand(factMutation('n-stale-a'));
    const acceptedA = await attestAndAccept(harness, proposedA.proposal.id, { attestationId: 'att-stale-a', mutationHash: hashA, expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-stale-a' });
    expect(acceptedA.outcome).toBe('accepted');
    expect(await harness.repository.getNamespaceRevision(NAMESPACE)).toBe(1);

    // -- Attempting B against its original (now-stale) expected revision is
    // a conflict, not an application: B's node must not exist afterward.
    const { mutationHash: hashB } = normalizeWriteCommand(factMutation('n-stale-b'));
    const staleAttempt = await attestAndAccept(harness, proposedB.proposal.id, { attestationId: 'att-stale-b-first', mutationHash: hashB, expectedVersion: 1, expectedTargetRevision: 0, idempotencyKey: 'accept-stale-b-first' });
    expect(staleAttempt.outcome).toBe('target_revision_conflict');
    if (staleAttempt.outcome === 'target_revision_conflict') {
      expect(staleAttempt.actualRevision).toBe(1);
    }
    expect(await harness.repository.getNode(NAMESPACE, asNodeId('n-stale-b'))).toBeUndefined();
    expect((await harness.service.getProposal(proposedB.proposal.id))?.status).toBe('pending');

    // -- Persist a refresh amendment retargeting the new current revision
    // (content unchanged, expectedNamespaceRevision updated) and inspect
    // its resulting diff before deciding.
    const refreshedMutation = factMutation('n-stale-b', { idempotencyKey: asIdempotencyKey('write-stale-b-refresh'), expectedNamespaceRevision: 1 });
    const refreshed = await harness.service.amend(proposedB.proposal.id, {
      expectedVersion: 1,
      mutation: refreshedMutation,
      supportingObservationIds: [],
      idempotencyKey: 'amend-stale-b-refresh',
    });
    expect(refreshed.version).toBe(2);

    const inspection = await harness.service.inspect(proposedB.proposal.id);
    expect(inspection.currentVersion.canonicalMutation.expectedNamespaceRevision).toBe(1);
    // Still pending, still not applied -- a refresh amendment is not itself
    // an acceptance.
    expect(inspection.proposal.status).toBe('pending');
    expect(await harness.repository.getNode(NAMESPACE, asNodeId('n-stale-b'))).toBeUndefined();

    // -- Only the explicit, new round of human review (accept against the
    // refreshed version/target) applies the mutation.
    const { mutationHash: refreshedHash } = normalizeWriteCommand(refreshedMutation);
    const acceptedB = await attestAndAccept(harness, proposedB.proposal.id, { attestationId: 'att-stale-b-refreshed', mutationHash: refreshedHash, expectedVersion: 2, expectedTargetRevision: 1, idempotencyKey: 'accept-stale-b-refreshed' });
    expect(acceptedB.outcome).toBe('accepted');
    if (acceptedB.outcome !== 'accepted') throw new Error('expected accepted');
    expect(acceptedB.resultingRevision).toBe(2);
    expect(await harness.repository.getNode(NAMESPACE, asNodeId('n-stale-b'))).toBeDefined();

    harness.connection.close();
  });

  it('rejects a stale proposal explicitly instead of refreshing it, and the mutation never applies', async () => {
    const harness = createProposalsTestHarness();

    const proposedA = await harness.service.propose({ mutation: factMutation('n-stale-reject-a'), supportingObservationIds: [], idempotencyKey: 'propose-stale-reject-a' });
    if (proposedA.outcome !== 'created') throw new Error('expected created');
    const proposedB = await harness.service.propose({ mutation: factMutation('n-stale-reject-b'), supportingObservationIds: [], idempotencyKey: 'propose-stale-reject-b' });
    if (proposedB.outcome !== 'created') throw new Error('expected created');

    const { mutationHash: hashA } = normalizeWriteCommand(factMutation('n-stale-reject-a'));
    await attestAndAccept(harness, proposedA.proposal.id, { attestationId: 'att-stale-reject-a', mutationHash: hashA, expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-stale-reject-a' });

    const { mutationHash: hashB } = normalizeWriteCommand(factMutation('n-stale-reject-b'));
    const staleAttempt = await attestAndAccept(harness, proposedB.proposal.id, { attestationId: 'att-stale-reject-b', mutationHash: hashB, expectedVersion: 1, expectedTargetRevision: 0, idempotencyKey: 'accept-stale-reject-b' });
    expect(staleAttempt.outcome).toBe('target_revision_conflict');

    const rejected = await harness.service.reject(proposedB.proposal.id, {
      expectedVersion: 1,
      actorId: REVIEWER,
      reason: 'Superseded by the accepted proposal; not worth refreshing.',
      idempotencyKey: 'reject-stale-b',
    });
    expect(rejected.status).toBe('rejected');
    expect(await harness.repository.getNode(NAMESPACE, asNodeId('n-stale-reject-b'))).toBeUndefined();

    harness.connection.close();
  });

  it('records inv4-stale-conflict-integrity evidence once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'inv4-stale-conflict-integrity',
      suite: 'packages/governed/tests/proposals/stale-conflict-refresh.test.ts',
      fixture: 'two proposals racing one revision: accept-first/conflict-second/refresh-amend/re-review (accept or reject)',
      backend: 'sqlite',
      durationMs: Date.now() - suiteStart,
    });
  });
});
