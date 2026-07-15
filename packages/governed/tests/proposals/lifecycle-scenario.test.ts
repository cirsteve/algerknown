import { describe, expect, it } from 'vitest';
import { asActorId, asAttestationId, asIdempotencyKey, asNamespaceId, asNodeId, asSubjectId, normalizeWriteCommand, type WriteCommand } from '../../src/index.js';
import { createProposalsTestHarness } from './harness.js';
import { recordSuiteEvidence, trackSuiteFailures } from '../acceptance/evidence-helpers.js';

const NAMESPACE = asNamespaceId('canonical.global');
const SUBJECT = asSubjectId('subject-lifecycle');
const PROCESSOR = asActorId('processor-author-1');
const REVIEWER = asActorId('reviewer-1');

function factMutation(nodeId: string, statement: string, overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: NAMESPACE,
    subject: SUBJECT,
    nodeMutations: [{ op: 'create', nodeId: asNodeId(nodeId), nodeType: 'fact', payload: { statement }, confidence: 0.9 }],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey(`write-${nodeId}`),
    actorId: PROCESSOR,
    actorClass: 'human',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
    ...overrides,
  };
}

async function attestAndAccept(
  harness: ReturnType<typeof createProposalsTestHarness>,
  proposalId: string,
  opts: { attestationId: string; mutationHash: string; expectedVersion: number; idempotencyKey: string },
) {
  harness.attestationVerifier.register({
    id: asAttestationId(opts.attestationId),
    reviewerId: REVIEWER,
    approvedAt: harness.clock.now(),
    proposalId: proposalId as never,
    proposalVersion: opts.expectedVersion,
    targetRevision: null,
    mutationHash: opts.mutationHash as never,
    channel: 'test',
    verifierMeta: {},
  });
  return harness.service.accept(proposalId as never, {
    expectedVersion: opts.expectedVersion,
    expectedTargetRevision: null,
    attestationId: asAttestationId(opts.attestationId),
    actorId: REVIEWER,
    channel: 'test',
    idempotencyKey: opts.idempotencyKey,
  });
}

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

/**
 * EC2: one shared narrative driving every proposal lifecycle transition
 * (propose, inspect, amend, accept-with-attestation, reject-with-reason,
 * expire-with-note, tombstone-delete-with-reason, revert-with-reason)
 * against the same harness, with explicit assertions for every property the
 * exit criterion names. Fine-grained edge cases for each transition already
 * live in proposals/service.test.ts; this file is the consolidated scenario,
 * not a duplicate of that coverage.
 */
describe('EC2: shared proposal lifecycle scenario', () => {
  it('propose -> inspect -> amend -> accept -> revert, with reviewer/processor separation and idempotent replay', async () => {
    const harness = createProposalsTestHarness();

    const proposed = await harness.service.propose({
      mutation: factMutation('n-lifecycle-1', 'The lifecycle fact, first phrasing.'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-lifecycle-1',
    });
    if (proposed.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposed.proposal.id;

    // -- inspect: version 1, one immutable 'proposed' event.
    const afterPropose = await harness.service.inspect(proposalId);
    expect(afterPropose.proposal.version).toBe(1);
    expect(afterPropose.events.map((e) => e.kind)).toEqual(['proposed']);
    const proposeMutationHash = afterPropose.currentVersion.mutationHash;

    // -- amend: new immutable version, distinct mutation hash, 'amended' event appended (not replacing history).
    const amendMutation = factMutation('n-lifecycle-1', 'The lifecycle fact, amended phrasing.', { idempotencyKey: asIdempotencyKey('write-amend-1') });
    const amended = await harness.service.amend(proposalId, { expectedVersion: 1, mutation: amendMutation, supportingObservationIds: [], idempotencyKey: 'amend-lifecycle-1' });
    expect(amended.version).toBe(2);
    const afterAmend = await harness.service.inspect(proposalId);
    expect(afterAmend.events.map((e) => e.kind)).toEqual(['proposed', 'amended']);
    expect(afterAmend.currentVersion.mutationHash).not.toBe(proposeMutationHash);
    // v1's own record is untouched -- amend appends, it never rewrites.
    const v1AfterAmend = await harness.service.inspect(proposalId, 1);
    expect(v1AfterAmend.currentVersion.mutationHash).toBe(proposeMutationHash);

    // -- accept with attestation: server-recorded time/channel, expected
    // revision honored, resulting revision returned, forward diff visible.
    const { mutationHash: amendedHash } = normalizeWriteCommand(amendMutation);
    const accepted = await attestAndAccept(harness, proposalId, { attestationId: 'att-lifecycle-1', mutationHash: amendedHash, expectedVersion: 2, idempotencyKey: 'accept-lifecycle-1' });
    expect(accepted.outcome).toBe('accepted');
    if (accepted.outcome !== 'accepted') throw new Error('expected accepted');
    expect(accepted.resultingRevision).toBe(1);

    const revisions = await harness.repository.listRevisionsSince(NAMESPACE, 0);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.diff.length).toBeGreaterThan(0);
    expect(revisions[0]!.diff.every((d) => d.changeKind === 'create')).toBe(true);

    const acceptedNode = await harness.repository.getNode(NAMESPACE, asNodeId('n-lifecycle-1'));
    expect((acceptedNode!.payload as { statement: string }).statement).toBe('The lifecycle fact, amended phrasing.');

    // -- reviewer/processor separation: the *content's* attributed author is
    // the processor who proposed/amended it; the 'accepted' *event*'s actor
    // is the reviewer who approved it -- two distinct, never-conflated ids.
    expect(String(acceptedNode!.revision.actorId)).toBe(String(PROCESSOR));
    const acceptedEvent = (await harness.service.inspect(proposalId)).events.find((e) => e.kind === 'accepted')!;
    expect(String(acceptedEvent.actorId)).toBe(String(REVIEWER));
    expect(acceptedEvent.channel).toBe('test');
    // server-recorded time: every event's `at` comes from the deterministic
    // harness clock, never a client-supplied value (accept/reject/expire/
    // delete/revert inputs carry no time field at all).
    expect(afterPropose.events[0]!.at <= acceptedEvent.at).toBe(true);

    // -- idempotent replay: resubmitting the exact same accept call (same
    // idempotency key *and* the same request body, including attestationId)
    // returns the identical outcome without a second attestation or event --
    // even though the proposal has already moved past 'pending'.
    const eventsBeforeReplay = (await harness.service.inspect(proposalId)).events.length;
    const replay = await harness.service.accept(proposalId, {
      expectedVersion: 2,
      expectedTargetRevision: null,
      attestationId: asAttestationId('att-lifecycle-1'),
      actorId: REVIEWER,
      channel: 'test',
      idempotencyKey: 'accept-lifecycle-1',
    });
    expect(replay).toEqual(accepted);
    const eventsAfterReplay = (await harness.service.inspect(proposalId)).events.length;
    expect(eventsAfterReplay).toBe(eventsBeforeReplay);
    expect(await harness.repository.getNamespaceRevision(NAMESPACE)).toBe(1);

    // -- stale conflict: a second proposal accepted against an
    // already-superseded expected version is rejected before ever reaching
    // the write path, and the proposal stays exactly as it was.
    const staleTarget = await harness.service.propose({ mutation: factMutation('n-lifecycle-stale', 'Stale target.'), supportingObservationIds: [], idempotencyKey: 'propose-stale' });
    if (staleTarget.outcome !== 'created') throw new Error('expected created');
    await harness.service.amend(staleTarget.proposal.id, {
      expectedVersion: 1,
      mutation: factMutation('n-lifecycle-stale', 'Stale target, amended.', { idempotencyKey: asIdempotencyKey('write-stale-amend') }),
      supportingObservationIds: [],
      idempotencyKey: 'amend-stale',
    });
    const staleAccept = await attestAndAccept(harness, staleTarget.proposal.id, { attestationId: 'att-stale', mutationHash: proposeMutationHash, expectedVersion: 1, idempotencyKey: 'accept-stale' });
    expect(staleAccept.outcome).toBe('version_conflict');
    expect((await harness.service.getProposal(staleTarget.proposal.id))?.status).toBe('pending');

    // -- revert with reason: canonical.global is human-policy (attestation
    // required for revert too), so this is the two-phase proposeRevert +
    // attested revert path -- attributable new revision, correction
    // attribution recorded, inverse diff appended (history, not rewritten).
    const revertCandidate = await harness.service.proposeRevert(proposalId, { actorId: REVIEWER, actorClass: 'human', idempotencyKey: 'prepare-revert-lifecycle-1' });
    const candidateBeforeAttestation = await harness.service.getProposal(revertCandidate.revertProposalId);
    harness.attestationVerifier.register({
      id: asAttestationId('att-revert-lifecycle-1'),
      reviewerId: REVIEWER,
      approvedAt: harness.clock.now(),
      proposalId: revertCandidate.revertProposalId,
      proposalVersion: revertCandidate.revertProposalVersion,
      targetRevision: candidateBeforeAttestation!.expectedTargetRevision,
      mutationHash: revertCandidate.mutationHash,
      channel: 'test',
      verifierMeta: {},
    });
    const reverted = await harness.service.revert(proposalId, {
      actorId: REVIEWER,
      actorClass: 'human',
      reason: 'Superseded by later review.',
      channel: 'test',
      idempotencyKey: 'revert-lifecycle-1',
      revertCandidateId: revertCandidate.revertProposalId,
      attestationId: asAttestationId('att-revert-lifecycle-1'),
    });
    expect(reverted.outcome).toBe('reverted');
    if (reverted.outcome !== 'reverted') throw new Error('expected reverted');
    expect(reverted.newRevision).toBe(2);
    expect(await harness.repository.getNode(NAMESPACE, asNodeId('n-lifecycle-1'))).toBeUndefined();

    const revisionsAfterRevert = await harness.repository.listRevisionsSince(NAMESPACE, 0);
    expect(revisionsAfterRevert).toHaveLength(2);
    expect(revisionsAfterRevert[1]!.diff.some((d) => d.changeKind === 'revert')).toBe(true);
    // the original create revision is untouched -- reversal is new history.
    expect(revisionsAfterRevert[0]!.diff).toEqual(revisions[0]!.diff);

    const reversalRow = harness.connection.db.prepare('SELECT actor_id, reason FROM reversals WHERE proposal_id = ?').get(proposalId) as
      | { actor_id: string; reason: string }
      | undefined;
    expect(reversalRow?.actor_id).toBe(String(REVIEWER));
    expect(reversalRow?.reason).toBe('Superseded by later review.');

    // -- reject with a required reason (separate proposal, terminal from pending).
    const toReject = await harness.service.propose({ mutation: factMutation('n-lifecycle-reject', 'Will be rejected.'), supportingObservationIds: [], idempotencyKey: 'propose-reject' });
    if (toReject.outcome !== 'created') throw new Error('expected created');
    const rejected = await harness.service.reject(toReject.proposal.id, { expectedVersion: 1, actorId: REVIEWER, reason: 'Not credible enough.', idempotencyKey: 'reject-lifecycle-1' });
    expect(rejected.status).toBe('rejected');
    const rejectEvent = (await harness.service.inspect(toReject.proposal.id)).events.find((e) => e.kind === 'rejected')!;
    expect(rejectEvent.reason).toBe('Not credible enough.');
    expect(String(rejectEvent.actorId)).toBe(String(REVIEWER));

    // -- expire with a required note (separate proposal, terminal from pending).
    const toExpire = await harness.service.propose({ mutation: factMutation('n-lifecycle-expire', 'Will expire.'), supportingObservationIds: [], idempotencyKey: 'propose-expire' });
    if (toExpire.outcome !== 'created') throw new Error('expected created');
    const expired = await harness.service.expire(toExpire.proposal.id, { expectedVersion: 1, note: 'Superseded by newer evidence before review.', idempotencyKey: 'expire-lifecycle-1' });
    expect(expired.status).toBe('expired');
    const expireEvent = (await harness.service.inspect(toExpire.proposal.id)).events.find((e) => e.kind === 'expired')!;
    expect(expireEvent.note).toBe('Superseded by newer evidence before review.');

    // -- tombstone-delete with a required reason: history is preserved, not erased.
    const toDelete = await harness.service.propose({ mutation: factMutation('n-lifecycle-delete', 'Will be tombstoned.'), supportingObservationIds: [], idempotencyKey: 'propose-delete' });
    if (toDelete.outcome !== 'created') throw new Error('expected created');
    const deleted = await harness.service.delete(toDelete.proposal.id, { expectedVersion: 1, actorId: REVIEWER, reason: 'Duplicate of an existing proposal.', idempotencyKey: 'delete-lifecycle-1' });
    expect(deleted.status).toBe('deleted');
    const deleteInspection = await harness.service.inspect(toDelete.proposal.id);
    expect(deleteInspection.events.map((e) => e.kind)).toEqual(['proposed', 'deleted']);
    expect(deleteInspection.events.find((e) => e.kind === 'deleted')?.reason).toBe('Duplicate of an existing proposal.');

    harness.connection.close();
  });

  it('records ec2-lifecycle-attribution-reversal evidence once the scenario above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'ec2-lifecycle-attribution-reversal',
      suite: 'packages/governed/tests/proposals/lifecycle-scenario.test.ts',
      fixture: 'canonical.global human-gated proposal lifecycle (propose/inspect/amend/accept/revert/reject/expire/tombstone)',
      backend: 'sqlite',
      durationMs: Date.now() - suiteStart,
    });
  });
});
