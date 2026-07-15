import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, afterEach } from 'vitest';
import { asActorId, asAttestationId, asEdgeId, asIdempotencyKey, asNodeId, asProcessorId, type WriteCommand } from '@algerknown/governed';
import { namespaceForBinding, subjectForBinding } from '@algerknown/governed/adapters/algerknown';
import { loadGovernanceConfig } from '../../src/server/auth/governance-config.js';
import { createSessionRegistry } from '../../src/server/auth/session-registry.js';
import { createUnlockRateLimiter } from '../../src/server/auth/unlock-rate-limiter.js';
import type { GovernanceRuntime } from '../../src/server/auth/governance-runtime.js';
import { createGovernanceRouter } from '../../src/server/routes/governance.js';
import {
  acceptProposal,
  revertProposal,
  createGovernanceComposition,
  recoverIncompleteGitOperations,
  createIntent,
  type GovernanceComposition,
} from '../../src/server/governance/index.js';
import { createTestClock } from '../fixtures/clock.js';
import { seedKnowledgeBase, writeNamespaceBindings, testEnv, cleanup, type SeededKnowledgeBase } from './fixtures.js';

const ORIGIN = 'http://127.0.0.1:2393';
const REVIEWER_SECRET = 'r'.repeat(32);
const PROCESSOR_SECRET = 'p'.repeat(32);

function proposeCommand(kb: SeededKnowledgeBase, nodeId: string, edgeId: string, overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: namespaceForBinding(kb.binding),
    subject: subjectForBinding(kb.binding),
    nodeMutations: [
      {
        op: 'create',
        nodeId: asNodeId(nodeId),
        nodeType: 'fact',
        payload: { statement: `Statement for ${nodeId}.`, attributes: { status: 'shipped', safe_phrasings: [`Statement for ${nodeId}.`] } },
        confidence: 0.9,
      },
    ],
    edgeMutations: [
      { op: 'create', edgeId: asEdgeId(edgeId), kind: 'evidence_for', sourceId: asNodeId('evidence-1'), targetId: asNodeId(nodeId) },
    ],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey(`cmd-${nodeId}`),
    actorId: asActorId('test-processor'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'evidence-1' }], processorId: asProcessorId('test-processor') },
    ...overrides,
  };
}

/**
 * memory.project.* is declaratively SQLite-backed while retaining the
 * human-gated policy, so it requires the same attestation semantics as a
 * dossier namespace without pretending it has a git/YAML representation.
 */
function sqliteProposeCommand(nodeId: string, edgeId: string): WriteCommand {
  return {
    namespace: 'memory.project.demo' as WriteCommand['namespace'],
    subject: 'algerknown.summary:demo-dossier:memory' as WriteCommand['subject'],
    nodeMutations: [
      {
        op: 'create',
        nodeId: asNodeId(nodeId),
        nodeType: 'observation',
        payload: { description: `Observation for ${nodeId}` },
        confidence: 0.8,
      },
    ],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey(`cmd-${nodeId}`),
    actorId: asActorId('test-processor'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'evidence-1' }], processorId: asProcessorId('test-processor') },
  };
}

function gitCommitCount(repoRoot: string): number {
  return Number(execFileSync('git', ['-C', repoRoot, 'rev-list', '--count', 'HEAD'], { encoding: 'utf-8' }).trim());
}

describe('governance e2e invariants', () => {
  let kb: SeededKnowledgeBase;
  let env: NodeJS.ProcessEnv;
  let composition: GovernanceComposition | undefined;

  afterEach(() => {
    composition?.close();
    composition = undefined;
    if (kb && env) cleanup(kb, env);
  });

  it('missing attestation / direct mutation fields cannot bypass rails via the real router', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });

    const config = loadGovernanceConfig({
      GOVERNANCE_REVIEWER_ID: 'steve',
      GOVERNANCE_REVIEWER_DISPLAY_NAME: 'Steve',
      GOVERNANCE_REVIEWER_SECRET: REVIEWER_SECRET,
      GOVERNANCE_PROCESSOR_ID: 'test-processor',
      GOVERNANCE_PROCESSOR_SECRET: PROCESSOR_SECRET,
      GOVERNANCE_PUBLIC_ORIGIN: ORIGIN,
    });
    const clock = createTestClock();
    const runtime: GovernanceRuntime = { config, clock, sessionRegistry: createSessionRegistry({ clock }), unlockRateLimiter: createUnlockRateLimiter({ clock }) };
    const app = express();
    app.use(express.json());
    app.use('/api/governance', createGovernanceRouter(runtime, composition));

    const proposeOutcome = await composition.proposalService.propose({
      mutation: proposeCommand(kb, 'fact-bypass-1', 'edge-bypass-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-bypass-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;

    for (const forbiddenBody of [
      { expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'a', attestation: { id: 'forged' } },
      { expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'a', mutation: { op: 'update' } },
      { expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'a', mutation_hash: 'deadbeef' },
      { expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'a', reviewer_id: 'attacker' },
    ]) {
      const res = await request(app)
        .post(`/api/governance/proposals/${proposalId}/accept`)
        .set('Authorization', `Bearer ${REVIEWER_SECRET}`)
        .send(forbiddenBody);
      expect(res.status).toBe(400);
    }

    // The proposal must still be untouched -- none of the forged bodies applied anything.
    const proposal = await composition.proposalService.getProposal(proposalId);
    expect(proposal?.status).toBe('pending');
  });

  it('proposals and rejection reasons survive an app restart', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });

    const proposeOutcome = await composition.proposalService.propose({
      mutation: proposeCommand(kb, 'fact-restart-1', 'edge-restart-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-restart-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;

    await composition.proposalService.reject(proposalId, {
      expectedVersion: 1,
      actorId: asActorId('reviewer-1'),
      reason: 'Not accurate enough.',
      idempotencyKey: 'reject-restart-1',
    });

    // Simulate a process restart: close this composition and build a fresh
    // one against the exact same db path and content root.
    composition.close();
    composition = await createGovernanceComposition({ env });

    const reloaded = await composition.proposalService.inspect(proposalId);
    expect(reloaded.proposal.status).toBe('rejected');
    const rejectedEvent = reloaded.events.find((e) => e.kind === 'rejected');
    expect(rejectedEvent?.reason).toBe('Not accurate enough.');
  });

  it('resubmitting an identical candidate after rejection is suppressed with the same reason', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });

    const command = proposeCommand(kb, 'fact-dup-1', 'edge-dup-1');
    const first = await composition.proposalService.propose({ mutation: command, supportingObservationIds: [], idempotencyKey: 'propose-dup-first' });
    if (first.outcome !== 'created') throw new Error('expected created');

    await composition.proposalService.reject(first.proposal.id, {
      expectedVersion: 1,
      actorId: asActorId('reviewer-1'),
      reason: 'Duplicate of existing content.',
      idempotencyKey: 'reject-dup-1',
    });

    // A brand new submission of the exact same candidate content (different
    // outer idempotencyKey, as a fresh ingest job would produce) must be
    // suppressed rather than creating a second competing proposal.
    const second = await composition.proposalService.propose({
      mutation: command,
      supportingObservationIds: [],
      idempotencyKey: 'propose-dup-second',
    });
    expect(second.outcome).toBe('suppressed');
    if (second.outcome !== 'suppressed') throw new Error('expected suppressed');
    expect(second.priorProposalId).toBe(first.proposal.id);
    expect(second.reason).toBe('Duplicate of existing content.');
  });

  it('a duplicate accept attempt never produces a second git commit', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });

    const commitsBefore = gitCommitCount(kb.root);

    const proposeOutcome = await composition.proposalService.propose({
      mutation: proposeCommand(kb, 'fact-dupaccept-1', 'edge-dupaccept-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-dupaccept-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;
    const reviewContext = { reviewerId: asActorId('reviewer-1'), reviewerDisplayName: 'Reviewer', channel: 'cli' as const };
    const acceptInput = { reviewContext, expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-dupaccept-1' };

    const firstAccept = await acceptProposal(composition.reviewActionsDeps, proposalId, acceptInput);
    expect(firstAccept.outcome).toBe('accepted');
    expect(gitCommitCount(kb.root)).toBe(commitsBefore + 1);

    // A genuine retry of the exact same accept call (duplicate click, or a
    // client that never saw the first response) returns the identical
    // byte-for-byte outcome and never lands a second commit.
    const secondAccept = await acceptProposal(composition.reviewActionsDeps, proposalId, acceptInput);
    expect(secondAccept).toEqual(firstAccept);
    expect(gitCommitCount(kb.root)).toBe(commitsBefore + 1);
  });

  it('recovers an incomplete git operation intent left by a simulated crash', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });
    const { db, proposalService, idGenerator, clock, attestationVerifier } = composition.reviewActionsDeps;

    const proposeOutcome = await proposalService.propose({
      mutation: proposeCommand(kb, 'fact-crash-1', 'edge-crash-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-crash-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;

    // Apply the write directly through review-actions (which records+
    // completes the intent normally)...
    const reviewContext = { reviewerId: asActorId('reviewer-1'), reviewerDisplayName: 'Reviewer', channel: 'cli' as const };
    await acceptProposal(composition.reviewActionsDeps, proposalId, {
      reviewContext,
      expectedVersion: 1,
      expectedTargetRevision: null,
      idempotencyKey: 'accept-crash-1',
    });

    // ...then simulate a crash that happened *after* the write and finalize
    // succeeded but *before* this process recorded its own intent as
    // completed: leave a dangling 'started' intent row referencing that
    // already-accepted proposal.
    const proposal = await proposalService.getProposal(proposalId);
    if (!proposal) throw new Error('expected proposal');
    const inspection = await proposalService.inspect(proposalId);
    createIntent(db, {
      operationId: idGenerator.nextOperationId(),
      proposalId,
      action: 'accept',
      namespace: String(proposal.targetNamespace),
      commandIdempotencyKey: String((inspection.currentVersion.canonicalMutation as WriteCommand).idempotencyKey),
      expectedMutationHash: String(inspection.currentVersion.mutationHash),
      reviewInput: { expectedVersion: 1, expectedTargetRevision: null, attestationId: 'irrelevant-for-this-path', actorId: reviewContext.reviewerId, channel: 'cli', idempotencyKey: 'accept-crash-1' },
      createdAt: clock.now(),
    });

    await recoverIncompleteGitOperations({ db, proposalService, attestationVerifier, clock });

    const row = db.prepare(`SELECT status FROM web_git_operation_intents WHERE proposal_id = ?`).get(proposalId) as { status: string } | undefined;
    expect(row?.status).toBe('completed');
  });

  it('replays a pending git accept after restart using the durable attestation intent', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });
    const { db, proposalService, idGenerator, clock } = composition.reviewActionsDeps;

    const proposed = await proposalService.propose({
      mutation: proposeCommand(kb, 'fact-crash-before-write-1', 'edge-crash-before-write-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-crash-before-write-1',
    });
    if (proposed.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposed.proposal.id;
    const inspection = await proposalService.inspect(proposalId);
    const attestationId = asAttestationId('att-crash-before-write-1');
    const reviewInput = {
      expectedVersion: 1,
      expectedTargetRevision: null,
      attestationId,
      actorId: asActorId('reviewer-1'),
      channel: 'cli',
      reviewNote: 'Approved before the process stopped.',
      idempotencyKey: 'accept-crash-before-write-1',
    };
    const attestation = {
      id: attestationId,
      reviewerId: asActorId('reviewer-1'),
      approvedAt: clock.now(),
      proposalId,
      proposalVersion: 1,
      targetRevision: null,
      mutationHash: inspection.currentVersion.mutationHash,
      reviewNote: reviewInput.reviewNote,
      channel: 'cli',
      verifierMeta: {},
    };
    const commitsBefore = gitCommitCount(kb.root);

    createIntent(db, {
      operationId: idGenerator.nextOperationId(),
      proposalId,
      action: 'accept',
      namespace: String(proposed.proposal.targetNamespace),
      commandIdempotencyKey: String((inspection.currentVersion.canonicalMutation as WriteCommand).idempotencyKey),
      expectedMutationHash: String(inspection.currentVersion.mutationHash),
      reviewInput,
      attestation,
      createdAt: clock.now(),
    });

    composition.close();
    composition = await createGovernanceComposition({ env });

    expect((await composition.proposalService.getProposal(proposalId))?.status).toBe('accepted');
    expect(gitCommitCount(kb.root)).toBe(commitsBefore + 1);
    const attestationRow = composition.reviewActionsDeps.db
      .prepare(`SELECT reviewer_id, review_note FROM attestations WHERE attestation_id = ?`)
      .get(attestationId) as { reviewer_id: string; review_note: string | null } | undefined;
    expect(attestationRow).toEqual({ reviewer_id: 'reviewer-1', review_note: reviewInput.reviewNote });
    const intentRow = composition.reviewActionsDeps.db
      .prepare(`SELECT status FROM web_git_operation_intents WHERE proposal_id = ?`)
      .get(proposalId) as { status: string } | undefined;
    expect(intentRow?.status).toBe('completed');
  });

  it('blocks a dangling git operation intent whose mutation hash no longer matches, with no second write', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });
    const { db, proposalService, idGenerator, clock, attestationVerifier } = composition.reviewActionsDeps;

    const proposeOutcome = await proposalService.propose({
      mutation: proposeCommand(kb, 'fact-hashmismatch-1', 'edge-hashmismatch-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-hashmismatch-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;
    const commitsBefore = gitCommitCount(kb.root);

    // Simulate a crash strictly *after* the intent was recorded but *before*
    // the write was attempted at all: the proposal is still pending, and the
    // dangling intent's expectedMutationHash is deliberately stale (as if
    // the proposal had been amended between recording the intent and the
    // crash) -- recovery must refuse to replay a write against content the
    // intent was never actually recorded for.
    const inspection = await proposalService.inspect(proposalId);
    createIntent(db, {
      operationId: idGenerator.nextOperationId(),
      proposalId,
      action: 'accept',
      namespace: String(proposeOutcome.proposal.targetNamespace),
      commandIdempotencyKey: String((inspection.currentVersion.canonicalMutation as WriteCommand).idempotencyKey),
      expectedMutationHash: 'deliberately-stale-hash-does-not-match-current-version',
      reviewInput: { expectedVersion: 1, expectedTargetRevision: null, attestationId: 'irrelevant-for-this-path', actorId: asActorId('reviewer-1'), channel: 'cli', idempotencyKey: 'accept-hashmismatch-1' },
      createdAt: clock.now(),
    });

    await recoverIncompleteGitOperations({ db, proposalService, attestationVerifier, clock });

    const row = db.prepare(`SELECT status, note FROM web_git_operation_intents WHERE proposal_id = ?`).get(proposalId) as
      | { status: string; note: string | null }
      | undefined;
    expect(row?.status).toBe('blocked');
    expect(row?.note).toMatch(/mutation hash/);

    // No second write: the proposal is still pending, and the git history is
    // completely untouched -- recovery never even attempted the write.
    expect((await proposalService.getProposal(proposalId))?.status).toBe('pending');
    expect(gitCommitCount(kb.root)).toBe(commitsBefore);
  });

  it('reverting an accepted proposal produces an attributed new revision', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });

    const proposeOutcome = await composition.proposalService.propose({
      mutation: sqliteProposeCommand('obs-revert-1', 'edge-revert-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-revert-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;
    const reviewContext = { reviewerId: asActorId('reviewer-1'), reviewerDisplayName: 'Reviewer', channel: 'cli' as const };

    const accepted = await acceptProposal(composition.reviewActionsDeps, proposalId, {
      reviewContext,
      expectedVersion: 1,
      expectedTargetRevision: null,
      idempotencyKey: 'accept-revert-1',
    });
    if (accepted.outcome !== 'accepted') throw new Error('expected accepted');

    const node = await composition.repository.getNode('memory.project.demo' as WriteCommand['namespace'], asNodeId('obs-revert-1'));
    expect(node).toBeDefined();

    const reverted = await revertProposal(composition.reviewActionsDeps, proposalId, {
      reviewContext,
      reason: 'Accepted in error.',
      idempotencyKey: 'revert-revert-1',
    });
    expect(reverted.outcome).toBe('reverted');
    if (reverted.outcome !== 'reverted') throw new Error('expected reverted');
    expect(reverted.newRevision).toBe(accepted.resultingRevision + 1);

    const nodeAfterRevert = await composition.repository.getNode('memory.project.demo' as WriteCommand['namespace'], asNodeId('obs-revert-1'));
    expect(nodeAfterRevert).toBeUndefined();

    const reversalRow = composition.reviewActionsDeps.db
      .prepare('SELECT * FROM reversals WHERE proposal_id = ?')
      .get(proposalId) as { actor_id: string; reason: string } | undefined;
    expect(reversalRow?.actor_id).toBe('reviewer-1');
    expect(reversalRow?.reason).toBe('Accepted in error.');
  });

  it('reverting a git-backed dossier proposal lands a new attributed commit and removes the fact', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });

    const commitsBefore = gitCommitCount(kb.root);

    const proposeOutcome = await composition.proposalService.propose({
      mutation: proposeCommand(kb, 'fact-revert-git-1', 'edge-revert-git-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-revert-git-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;
    const reviewContext = { reviewerId: asActorId('reviewer-1'), reviewerDisplayName: 'Reviewer', channel: 'cli' as const };

    const accepted = await acceptProposal(composition.reviewActionsDeps, proposalId, {
      reviewContext,
      expectedVersion: 1,
      expectedTargetRevision: null,
      idempotencyKey: 'accept-revert-git-1',
    });
    if (accepted.outcome !== 'accepted') throw new Error('expected accepted');
    expect(gitCommitCount(kb.root)).toBe(commitsBefore + 1);

    const node = await composition.repository.getNode(namespaceForBinding(kb.binding), asNodeId('fact-revert-git-1'));
    expect(node).toBeDefined();

    const reverted = await revertProposal(composition.reviewActionsDeps, proposalId, {
      reviewContext,
      reason: 'Accepted in error.',
      idempotencyKey: 'revert-revert-git-1',
    });
    expect(reverted.outcome).toBe('reverted');
    if (reverted.outcome !== 'reverted') throw new Error('expected reverted');
    expect(reverted.newRevision).toBe(accepted.resultingRevision + 1);
    expect(gitCommitCount(kb.root)).toBe(commitsBefore + 2);

    const nodeAfterRevert = await composition.repository.getNode(namespaceForBinding(kb.binding), asNodeId('fact-revert-git-1'));
    expect(nodeAfterRevert).toBeUndefined();

    const reversalRow = composition.reviewActionsDeps.db
      .prepare('SELECT * FROM reversals WHERE proposal_id = ?')
      .get(proposalId) as { actor_id: string; reason: string } | undefined;
    expect(reversalRow?.actor_id).toBe('reviewer-1');
    expect(reversalRow?.reason).toBe('Accepted in error.');
  });
});
