import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { asActorId, asEdgeId, asIdempotencyKey, asNodeId, asProcessorId, type WriteCommand } from '@algerknown/governed';
import { namespaceForBinding, subjectForBinding } from '@algerknown/governed/adapters/algerknown';
import { acceptProposal, createGovernanceComposition, type GovernanceComposition } from '../../src/server/governance/index.js';
import { seedKnowledgeBase, writeNamespaceBindings, testEnv, cleanup, type SeededKnowledgeBase } from './fixtures.js';
import { recordSuiteEvidence, trackSuiteFailures } from './evidence-helpers.js';

function gitCommitCount(repoRoot: string): number {
  return Number(execFileSync('git', ['-C', repoRoot, 'rev-list', '--count', 'HEAD'], { encoding: 'utf-8' }).trim());
}

function proposeCommand(kb: SeededKnowledgeBase, nodeId: string, edgeId: string): WriteCommand {
  return {
    namespace: namespaceForBinding(kb.binding),
    subject: subjectForBinding(kb.binding),
    nodeMutations: [
      { op: 'create', nodeId: asNodeId(nodeId), nodeType: 'fact', payload: { statement: `Statement for ${nodeId}.`, attributes: { status: 'shipped', safe_phrasings: [`Statement for ${nodeId}.`] } }, confidence: 0.9 },
    ],
    edgeMutations: [{ op: 'create', edgeId: asEdgeId(edgeId), kind: 'evidence_for', sourceId: asNodeId('evidence-1'), targetId: asNodeId(nodeId) }],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey(`cmd-${nodeId}`),
    actorId: asActorId('test-processor'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'evidence-1' }], processorId: asProcessorId('test-processor') },
  };
}

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

describe('INV5: idempotent duplicate acceptance', () => {
  let kb: SeededKnowledgeBase | undefined;
  let env: NodeJS.ProcessEnv | undefined;
  let composition: GovernanceComposition | undefined;

  afterEach(() => {
    composition?.close();
    if (kb && env) cleanup(kb, env);
  });

  it('a sequential retry after a simulated lost response returns a byte-identical result with no duplicate write', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });
    const commitsBefore = gitCommitCount(kb.root);

    const proposeOutcome = await composition.proposalService.propose({
      mutation: proposeCommand(kb, 'fact-inv5-sequential-1', 'edge-inv5-sequential-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-inv5-sequential-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;
    const reviewContext = { reviewerId: asActorId('reviewer-1'), reviewerDisplayName: 'Reviewer', channel: 'cli' as const };
    const acceptInput = { reviewContext, expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-inv5-sequential-1' };

    // First call succeeds; imagine its HTTP response was lost in transit.
    const first = await acceptProposal(composition.reviewActionsDeps, proposalId, acceptInput);
    expect(first.outcome).toBe('accepted');

    // The client, never having seen a response, retries the exact same request.
    const second = await acceptProposal(composition.reviewActionsDeps, proposalId, acceptInput);
    expect(second).toEqual(first);

    expect(gitCommitCount(kb.root)).toBe(commitsBefore + 1);
    const attestationCount = (composition.reviewActionsDeps.db.prepare('SELECT COUNT(*) AS n FROM attestations WHERE proposal_id = ?').get(proposalId) as { n: number }).n;
    expect(attestationCount).toBe(1);
    const acceptedEventCount = (
      composition.reviewActionsDeps.db.prepare(`SELECT COUNT(*) AS n FROM proposal_events WHERE proposal_id = ? AND kind = 'accepted'`).get(proposalId) as { n: number }
    ).n;
    expect(acceptedEventCount).toBe(1);
    const usageCount = (composition.reviewActionsDeps.db.prepare('SELECT COUNT(*) AS n FROM processor_usage WHERE processor_id = ?').get('test-processor') as { n: number }).n;
    expect(usageCount).toBe(1);
  });

  it('two concurrent clients racing the same idempotency key converge on one commit, one attestation, one accepted event', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });
    const commitsBefore = gitCommitCount(kb.root);

    const proposeOutcome = await composition.proposalService.propose({
      mutation: proposeCommand(kb, 'fact-inv5-concurrent-1', 'edge-inv5-concurrent-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-inv5-concurrent-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;
    const reviewContext = { reviewerId: asActorId('reviewer-1'), reviewerDisplayName: 'Reviewer', channel: 'cli' as const };
    const acceptInput = { reviewContext, expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-inv5-concurrent-1' };

    const [a, b] = await Promise.all([
      acceptProposal(composition.reviewActionsDeps, proposalId, acceptInput),
      acceptProposal(composition.reviewActionsDeps, proposalId, acceptInput),
    ]);
    expect(a.outcome).toBe('accepted');
    expect(b.outcome).toBe('accepted');
    expect(a).toEqual(b);

    expect(gitCommitCount(kb.root)).toBe(commitsBefore + 1);
    const attestationCount = (composition.reviewActionsDeps.db.prepare('SELECT COUNT(*) AS n FROM attestations WHERE proposal_id = ?').get(proposalId) as { n: number }).n;
    expect(attestationCount).toBe(1);
    const acceptedEventCount = (
      composition.reviewActionsDeps.db.prepare(`SELECT COUNT(*) AS n FROM proposal_events WHERE proposal_id = ? AND kind = 'accepted'`).get(proposalId) as { n: number }
    ).n;
    expect(acceptedEventCount).toBe(1);
    const usageCount = (composition.reviewActionsDeps.db.prepare('SELECT COUNT(*) AS n FROM processor_usage WHERE processor_id = ?').get('test-processor') as { n: number }).n;
    expect(usageCount).toBe(1);
  });

  it('records inv5-idempotent-duplicate-acceptance evidence once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'inv5-idempotent-duplicate-acceptance',
      suite: 'packages/web/tests/governance/idempotent-duplicate-acceptance.test.ts',
      fixture: 'git-backed accept, sequential retry after simulated lost response and Promise.all concurrent duplicate accept',
      backend: 'algerknown',
      durationMs: Date.now() - suiteStart,
    });
  });
});
