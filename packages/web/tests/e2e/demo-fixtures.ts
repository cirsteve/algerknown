/**
 * Seeds a temporary, entirely local governed KB + sqlite database for the
 * Phase 2 demo recording, then writes build/phase2-demo/seed-manifest.json
 * describing what it seeded (proposal ids by role, generated credentials) so
 * both the orchestrator (scripts/governance/run-demo.mjs) and the Playwright
 * spec can drive the rest of the demo without hard-coding ids.
 *
 * Run standalone: `npx tsx tests/e2e/demo-fixtures.ts` (from packages/web).
 * Everything it writes lives under build/phase2-demo/ -- never touches a
 * real content repository or a real secret.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  asActorId,
  asEdgeId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asProcessorId,
  asSubjectId,
  type WriteCommand,
} from '@algerknown/governed';
import { createGovernanceComposition } from '../../src/server/governance/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const demoDir = path.join(repoRoot, 'build', 'phase2-demo');

const NAMESPACE = asNamespaceId('memory.project.demo-review');
const SUBJECT = asSubjectId('algerknown.summary:demo-review:memory');
const CONFLICT_NAMESPACE = asNamespaceId('memory.project.demo-conflict');
const CONFLICT_SUBJECT = asSubjectId('algerknown.summary:demo-conflict:memory');

function randomSecret(): string {
  return randomBytes(24).toString('hex'); // 48 hex chars, well over the 32-byte floor
}

export interface DemoManifest {
  algerknownRoot: string;
  dbPath: string;
  reviewerId: string;
  reviewerDisplayName: string;
  reviewerSecret: string;
  processorId: string;
  processorSecret: string;
  publicOriginPlaceholderPort: number;
  proposals: {
    amend: string;
    reject: string;
    historyRevert: string;
    contradicts: string;
    staleFirst: string;
    staleSecond: string;
  };
}

async function main(): Promise<void> {
  fs.rmSync(demoDir, { recursive: true, force: true });
  fs.mkdirSync(demoDir, { recursive: true });

  const algerknownRoot = path.join(demoDir, 'kb');
  fs.mkdirSync(path.join(algerknownRoot, '.algerknown'), { recursive: true });
  fs.writeFileSync(path.join(algerknownRoot, '.algerknown', 'governed-namespaces.json'), JSON.stringify({ dossiers: [] }, null, 2));

  const dbPath = path.join(demoDir, 'governed.sqlite');
  const reviewerSecret = randomSecret();
  const processorSecret = randomSecret();
  const reviewerId = 'steve';
  const processorId = 'demo-processor';

  const composition = await createGovernanceComposition({
    env: {
      ALGERKNOWN_ROOT: algerknownRoot,
      GOVERNANCE_DB_PATH: dbPath,
      GOVERNANCE_PROCESSOR_ID: processorId,
      GOVERNANCE_PROCESSOR_VERSION: 'demo',
    },
  });

  function proposeCommand(
    nodeId: string,
    statement: { description: string } | { statement: string; rationale?: string },
    kind: 'observation' | 'decision',
    namespace = NAMESPACE,
    subject = SUBJECT,
    expectedNamespaceRevision: number | null = null,
  ): WriteCommand {
    return {
      namespace,
      subject,
      nodeMutations: [{ op: 'create', nodeId: asNodeId(nodeId), nodeType: kind, payload: statement, confidence: 0.85 }],
      edgeMutations: [],
      expectedNamespaceRevision,
      idempotencyKey: asIdempotencyKey(`demo-${nodeId}`),
      actorId: asActorId(processorId),
      actorClass: 'processor',
      provenanceInput: { sources: [{ kind: 'external', id: 'demo-evidence-1' }], processorId: asProcessorId(processorId) },
    };
  }

  const amendProposed = await composition.proposalService.propose({
    mutation: proposeCommand(
      'decision-amend-1',
      { statement: 'Ship the v1 review console as drafted.', rationale: 'Matches the reviewed design doc.' },
      'decision',
    ),
    supportingObservationIds: [],
    idempotencyKey: 'demo-propose-amend',
  });
  if (amendProposed.outcome !== 'created') throw new Error('expected created (amend)');

  const rejectProposed = await composition.proposalService.propose({
    mutation: proposeCommand('observation-reject-1', { description: 'Candidate insight that turns out not to be credible enough.' }, 'observation'),
    supportingObservationIds: [],
    idempotencyKey: 'demo-propose-reject',
  });
  if (rejectProposed.outcome !== 'created') throw new Error('expected created (reject)');

  const historyProposed = await composition.proposalService.propose({
    mutation: proposeCommand('observation-history-1', { description: 'Candidate insight for the history and revert walkthrough.' }, 'observation'),
    supportingObservationIds: [],
    idempotencyKey: 'demo-propose-history',
  });
  if (historyProposed.outcome !== 'created') throw new Error('expected created (history)');

  // A contradicts edge: a real, storable governed relationship (not a
  // fabricated verdict) -- the composition's contradiction detector is a
  // deliberate no-op (see contradiction-detector.ts), so no automatically
  // *detected* contradiction can be demonstrated through a genuine write;
  // this instead shows the edge kind a caller can legitimately declare,
  // rendered in the Provenance tab's "Evidence relationships" as a real
  // red `contradicts` badge.
  const contradictsCommand = proposeCommand('observation-contradicts-1', { description: 'This observation is understood to contradict an earlier claim.' }, 'observation');
  contradictsCommand.edgeMutations = [
    { op: 'create', edgeId: asEdgeId('demo-contradicts-edge-1'), kind: 'contradicts', sourceId: asNodeId('observation-contradicts-1'), targetId: asNodeId('observation-history-1') },
  ];
  const contradictsProposed = await composition.proposalService.propose({
    mutation: contradictsCommand,
    supportingObservationIds: [],
    idempotencyKey: 'demo-propose-contradicts',
  });
  if (contradictsProposed.outcome !== 'created') throw new Error('expected created (contradicts)');

  // Both proposals target the conflict namespace's initial revision (0,
  // since it has never been written to). Accepting the first advances the
  // namespace to revision 1, which is what makes the second's *recorded*
  // expected revision (still 0) stale -- staleness is evaluated against the
  // proposal's own expectedNamespaceRevision at propose time, not against
  // whatever the namespace revision happens to be when a reviewer looks.
  const staleFirstProposed = await composition.proposalService.propose({
    mutation: proposeCommand('observation-stale-first', { description: 'First proposal to land against the conflict namespace.' }, 'observation', CONFLICT_NAMESPACE, CONFLICT_SUBJECT, 0),
    supportingObservationIds: [],
    idempotencyKey: 'demo-propose-stale-first',
  });
  if (staleFirstProposed.outcome !== 'created') throw new Error('expected created (stale first)');

  const staleSecondProposed = await composition.proposalService.propose({
    mutation: proposeCommand('observation-stale-second', { description: 'Second proposal, destined to go stale once the first is accepted.' }, 'observation', CONFLICT_NAMESPACE, CONFLICT_SUBJECT, 0),
    supportingObservationIds: [],
    idempotencyKey: 'demo-propose-stale-second',
  });
  if (staleSecondProposed.outcome !== 'created') throw new Error('expected created (stale second)');

  composition.close();

  const manifest: DemoManifest = {
    algerknownRoot,
    dbPath,
    reviewerId,
    reviewerDisplayName: 'Steve (Phase 2 demo)',
    reviewerSecret,
    processorId,
    processorSecret,
    publicOriginPlaceholderPort: 0,
    proposals: {
      amend: amendProposed.proposal.id,
      reject: rejectProposed.proposal.id,
      historyRevert: historyProposed.proposal.id,
      contradicts: contradictsProposed.proposal.id,
      staleFirst: staleFirstProposed.proposal.id,
      staleSecond: staleSecondProposed.proposal.id,
    },
  };
  fs.writeFileSync(path.join(demoDir, 'seed-manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(demoDir, '.env.local'),
    [
      `# Generated test-only credentials for the Phase 2 demo. Never real secrets; never commit.`,
      `GOVERNANCE_REVIEWER_ID=${reviewerId}`,
      `GOVERNANCE_REVIEWER_DISPLAY_NAME="Steve (Phase 2 demo)"`,
      `GOVERNANCE_REVIEWER_SECRET=${reviewerSecret}`,
      `GOVERNANCE_PROCESSOR_ID=${processorId}`,
      `GOVERNANCE_PROCESSOR_SECRET=${processorSecret}`,
      `ALGERKNOWN_ROOT=${algerknownRoot}`,
      `GOVERNANCE_DB_PATH=${dbPath}`,
      '',
    ].join('\n'),
  );
  console.log(`[demo-fixtures] seeded ${Object.keys(manifest.proposals).length} proposals; manifest at ${path.join(demoDir, 'seed-manifest.json')}`);
  console.log(`[demo-fixtures] reviewer secret (test-only): ${reviewerSecret}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
