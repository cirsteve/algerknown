import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import express from 'express';
import type { Dossier, Summary } from '@algerknown/core';
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
import { namespaceForBinding, subjectForBinding, type DossierBinding } from '@algerknown/governed/adapters/algerknown';
import { seedFixtureRepo } from '../../../governed/tests/fixtures/algerknown/loader.js';
import { GovernanceClient } from '../../../cli/src/governance/http-client.js';
import { loadGovernanceConfig } from '../../src/server/auth/governance-config.js';
import { createSessionRegistry } from '../../src/server/auth/session-registry.js';
import { createUnlockRateLimiter } from '../../src/server/auth/unlock-rate-limiter.js';
import type { GovernanceRuntime } from '../../src/server/auth/governance-runtime.js';
import { createGovernanceRouter } from '../../src/server/routes/governance.js';
import { acceptProposal, createGovernanceComposition, revertProposal, type GovernanceComposition } from '../../src/server/governance/index.js';
import { createTestClock } from '../fixtures/clock.js';
import { writeNamespaceBindings, testEnv, cleanup as cleanupDb } from './fixtures.js';
import { recordSuiteEvidence, trackSuiteFailures } from './evidence-helpers.js';

const BINDING: DossierBinding = { projectKey: 'agent-evals', summaryId: 'agent-evals-dossier', path: 'summaries/agent-evals-dossier.yaml' };
// memory.community.* is ai-with-rails (direct processor writes, no
// attestation) -- unlike memory.project.* (human-gated), which is exercised
// by the fact-update propose/amend/accept path below.
const MEMORY_NAMESPACE = asNamespaceId('memory.community.agent-evals');
const MEMORY_SUBJECT = asSubjectId('algerknown.summary:agent-evals-dossier:memory');
const REVIEWER_SECRET = 'r'.repeat(32);
const TEST_ONLY_PHRASE = 'TEST-ONLY: deterministic additional safe phrasing recorded for Phase 2 acceptance (EC4).';
const TEST_ONLY_PHRASE_AMENDED = 'TEST-ONLY: deterministic additional safe phrasing recorded for Phase 2 acceptance (EC4, amended).';

function readDossierFile(repoRoot: string): { dossier: Dossier; raw: string } {
  const filePath = path.join(repoRoot, BINDING.path);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return { dossier: (parse(raw) as Summary).dossier!, raw };
}

function gitLog(repoRoot: string): string[] {
  return execFileSync('git', ['-C', repoRoot, 'log', '--format=%H'], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
}

function gitShowTrailers(repoRoot: string, sha: string): string {
  return execFileSync('git', ['-C', repoRoot, 'show', '--no-patch', '--format=%B', sha], { encoding: 'utf-8' });
}

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

/**
 * The full Exit Criterion 4 scenario: a real fact update, amendment, and
 * attributable reversal against a temporary copy of the pinned cohort-1
 * dossier, visible through the governed HTTP API, the CLI's own
 * GovernanceClient, and raw git history -- plus a derived observation (with
 * a real derived_from edge) built from that same pinned evidence.
 */
describe('EC4: pinned dossier update, amendment, human-gated accept, and attributable revert', () => {
  let repoRoot: string | undefined;
  let env: NodeJS.ProcessEnv | undefined;
  let composition: GovernanceComposition | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    composition?.close();
    if (repoRoot && env) cleanupDb({ root: repoRoot, binding: BINDING }, env);
  });

  it('updates, amends, accepts, and reverts a pinned fact, visible via API/CLI/git', async () => {
    // Seed a *temporary copy* of the pinned, human-approved cohort-1 fixture
    // -- never the committed vendored snapshot itself.
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ec4-pinned-dossier-'));
    fs.rmSync(repoRoot, { recursive: true, force: true });
    seedFixtureRepo(repoRoot);
    const { dossier: originalDossier, raw: originalRaw } = readDossierFile(repoRoot);
    const targetFact = originalDossier.facts[0]!;
    const originalSafePhrasings = [...targetFact.safe_phrasings];
    const originalEvidenceId = originalDossier.evidence[0]!.id;
    const originalEvidenceLocator = originalDossier.evidence[0]!.locator;

    writeNamespaceBindings(repoRoot, [BINDING]);
    env = testEnv({ ALGERKNOWN_ROOT: repoRoot });
    composition = await createGovernanceComposition({ env });

    const commitsBefore = gitLog(repoRoot).length;

    const app = express();
    app.use(express.json());
    const clock = createTestClock();
    const config = loadGovernanceConfig({
      GOVERNANCE_REVIEWER_ID: 'steve',
      GOVERNANCE_REVIEWER_DISPLAY_NAME: 'Steve',
      GOVERNANCE_REVIEWER_SECRET: REVIEWER_SECRET,
      GOVERNANCE_PROCESSOR_ID: 'test-processor',
      GOVERNANCE_PROCESSOR_SECRET: 'p'.repeat(32),
      GOVERNANCE_PUBLIC_ORIGIN: 'http://127.0.0.1:2393',
    });
    const runtime: GovernanceRuntime = { config, clock, sessionRegistry: createSessionRegistry({ clock }), unlockRateLimiter: createUnlockRateLimiter({ clock }) };
    app.use('/api/governance', createGovernanceRouter(runtime, composition));
    server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}/api/governance`;

    // -- Step 1: a derived observation built from immutable fixture evidence,
    // in the memory namespace, exercising a real derived_from edge.
    const evidenceNoteResult = await composition.orchestrator.write({
      namespace: MEMORY_NAMESPACE,
      subject: MEMORY_SUBJECT,
      nodeMutations: [
        { op: 'create', nodeId: asNodeId('ec4-evidence-note-1'), nodeType: 'observation', payload: { description: `Reviewed pinned evidence: ${originalEvidenceLocator}` }, confidence: 0.9 },
      ],
      edgeMutations: [],
      expectedNamespaceRevision: null,
      idempotencyKey: asIdempotencyKey('ec4-evidence-note'),
      actorId: asActorId('test-processor'),
      actorClass: 'processor',
      provenanceInput: { sources: [{ kind: 'external', id: originalEvidenceId }], processorId: asProcessorId('test-processor') },
    } satisfies WriteCommand);
    expect(evidenceNoteResult.outcome).toBe('applied');

    const derivedInsightResult = await composition.orchestrator.write({
      namespace: MEMORY_NAMESPACE,
      subject: MEMORY_SUBJECT,
      nodeMutations: [
        { op: 'create', nodeId: asNodeId('ec4-derived-insight-1'), nodeType: 'observation', payload: { description: 'Derived insight synthesized from the reviewed evidence note.' }, confidence: 0.8 },
      ],
      edgeMutations: [
        { op: 'create', edgeId: asEdgeId('ec4-derived-edge-1'), kind: 'derived_from', sourceId: asNodeId('ec4-derived-insight-1'), targetId: asNodeId('ec4-evidence-note-1') },
      ],
      expectedNamespaceRevision: 1,
      idempotencyKey: asIdempotencyKey('ec4-derived-insight'),
      actorId: asActorId('test-processor'),
      actorClass: 'processor',
      provenanceInput: { sources: [{ kind: 'external', id: originalEvidenceId }], processorId: asProcessorId('test-processor'), sourceDerived: true },
    } satisfies WriteCommand);
    expect(derivedInsightResult.outcome).toBe('applied');
    const derivedEdge = await composition.repository.getEdge(MEMORY_NAMESPACE, asEdgeId('ec4-derived-edge-1'));
    expect(derivedEdge?.kind).toBe('derived_from');

    // -- Step 2: propose a deterministic test-only additional safe phrasing
    // on the existing fact, amend it once, accept through the human-gated
    // rail.
    const namespace = namespaceForBinding(BINDING);
    const subject = subjectForBinding(BINDING);
    const proposeOutcome = await composition.proposalService.propose({
      mutation: {
        namespace,
        subject,
        nodeMutations: [
          {
            op: 'update',
            nodeId: asNodeId(targetFact.id),
            payload: { statement: targetFact.claim, attributes: { status: targetFact.status, safe_phrasings: [...originalSafePhrasings, TEST_ONLY_PHRASE] } },
          },
        ],
        edgeMutations: [],
        expectedNamespaceRevision: null,
        idempotencyKey: asIdempotencyKey('ec4-fact-update-propose'),
        actorId: asActorId('test-processor'),
        actorClass: 'processor',
        provenanceInput: { sources: [{ kind: 'external', id: originalEvidenceId }], processorId: asProcessorId('test-processor') },
      },
      supportingObservationIds: [],
      idempotencyKey: 'ec4-fact-update-propose',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;

    const amended = await composition.proposalService.amend(proposalId, {
      expectedVersion: 1,
      mutation: {
        namespace,
        subject,
        nodeMutations: [
          {
            op: 'update',
            nodeId: asNodeId(targetFact.id),
            payload: { statement: targetFact.claim, attributes: { status: targetFact.status, safe_phrasings: [...originalSafePhrasings, TEST_ONLY_PHRASE_AMENDED] } },
          },
        ],
        edgeMutations: [],
        expectedNamespaceRevision: null,
        idempotencyKey: asIdempotencyKey('ec4-fact-update-amend'),
        actorId: asActorId('test-processor'),
        actorClass: 'processor',
        provenanceInput: { sources: [{ kind: 'external', id: originalEvidenceId }], processorId: asProcessorId('test-processor') },
      },
      supportingObservationIds: [],
      idempotencyKey: 'ec4-fact-update-amend',
    });
    expect(amended.version).toBe(2);

    const accepted = await acceptProposal(composition.reviewActionsDeps, proposalId, {
      reviewContext: { reviewerId: asActorId('steve'), reviewerDisplayName: 'Steve', channel: 'cli' },
      expectedVersion: 2,
      expectedTargetRevision: null,
      idempotencyKey: 'ec4-fact-update-accept',
    });
    expect(accepted.outcome).toBe('accepted');
    if (accepted.outcome !== 'accepted') throw new Error('expected accepted');

    // -- Assert: updated payload and provenance are visible through the
    // Repository port (the existing evidence_for edge is native to the
    // fact's evidence_ids and is untouched by this update).
    const updatedNode = await composition.repository.getNode(namespace, asNodeId(targetFact.id));
    expect((updatedNode!.payload as { attributes: { safe_phrasings: string[] } }).attributes.safe_phrasings).toContain(TEST_ONLY_PHRASE_AMENDED);
    expect(updatedNode!.provenance.sources.some((s) => s.id === originalEvidenceId)).toBe(true);

    // -- Assert: commit trailers and a new full git revision are visible
    // through raw git history.
    const commitsAfterAccept = gitLog(repoRoot);
    expect(commitsAfterAccept.length).toBe(commitsBefore + 1);
    const acceptTrailers = gitShowTrailers(repoRoot, commitsAfterAccept[0]!);
    expect(acceptTrailers).toMatch(/Operation-Id:/);
    expect(acceptTrailers).toMatch(/Revision-Id:/);
    // The commit's Actor-Id/-Class trail the *content's* author (the
    // processor who proposed/amended the mutation) -- reviewer attribution
    // for the *acceptance itself* lives in the proposal's accepted event
    // (asserted below via the API and CLI), matching processor/reviewer
    // separation.
    expect(acceptTrailers).toMatch(/Actor-Id: test-processor/);
    expect(acceptTrailers).toMatch(/Actor-Class: processor/);

    // Parsed, not raw-string containment: the YAML dumper line-wraps long
    // scalars, so the phrase's bytes aren't necessarily contiguous in the file.
    const { raw: rawAfterAccept, dossier: dossierAfterAccept } = readDossierFile(repoRoot);
    expect(rawAfterAccept).not.toBe(originalRaw);
    const factAfterAccept = dossierAfterAccept.facts.find((f) => f.id === targetFact.id)!;
    expect(factAfterAccept.safe_phrasings).toContain(TEST_ONLY_PHRASE_AMENDED);

    // -- Assert: visible via the real HTTP API (reviewer-authenticated).
    const apiDetailRes = await fetch(`${baseUrl}/proposals/${proposalId}`, { headers: { Authorization: `Bearer ${REVIEWER_SECRET}` } });
    const apiDetail = (await apiDetailRes.json()) as { status: string; reverted: boolean };
    expect(apiDetail.status).toBe('accepted');
    const apiHistoryRes = await fetch(`${baseUrl}/proposals/${proposalId}/history`, { headers: { Authorization: `Bearer ${REVIEWER_SECRET}` } });
    const apiHistory = (await apiHistoryRes.json()) as { events: { kind: string }[] };
    expect(apiHistory.events.some((e) => e.kind === 'accepted')).toBe(true);

    // -- Assert: visible via the CLI's own HTTP client (not a
    // re-implementation of the API contract).
    const cliClient = await GovernanceClient.create({ baseUrl, secret: REVIEWER_SECRET });
    const cliView = await cliClient.getProposal(proposalId);
    expect(cliView.status).toBe('accepted');
    const cliHistory = await cliClient.getProposalHistory(proposalId);
    expect((cliHistory.events as { kind: string }[]).some((e) => e.kind === 'accepted')).toBe(true);

    // -- Step 3: revert. Dossier bytes must return to the pinned original,
    // and history must contain both commits.
    const reverted = await revertProposal(composition.reviewActionsDeps, proposalId, {
      reviewContext: { reviewerId: asActorId('steve'), reviewerDisplayName: 'Steve', channel: 'cli' },
      reason: 'EC4 acceptance test-only change; reverting to restore the pinned fixture.',
      idempotencyKey: 'ec4-fact-update-revert',
    });
    expect(reverted.outcome).toBe('reverted');

    const commitsAfterRevert = gitLog(repoRoot);
    expect(commitsAfterRevert.length).toBe(commitsBefore + 2);
    expect(commitsAfterRevert).toEqual(expect.arrayContaining(commitsAfterAccept));

    // Structural, not raw-byte, equality: the adapter re-serializes the whole
    // YAML document on every write (its own quoting/line-wrap conventions),
    // so even a content-neutral round trip changes incidental formatting.
    // "the dossier payload" is the parsed structure this system of record
    // actually governs; that is what must be restored exactly.
    const { dossier: dossierAfterRevert } = readDossierFile(repoRoot);
    expect(dossierAfterRevert).toEqual(originalDossier);

    const cliViewAfterRevert = await cliClient.getProposal(proposalId);
    expect(cliViewAfterRevert.reverted).toBe(true);
  });

  it('records ec4-pinned-dossier-update evidence once the scenario above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'ec4-pinned-dossier-update',
      suite: 'packages/web/tests/governance/pinned-dossier-update.test.ts',
      fixture: 'pinned cohort-1 fixture (agent-evals-dossier) via governed/tests/fixtures/algerknown',
      backend: 'algerknown+sqlite',
      durationMs: Date.now() - suiteStart,
    });
  });
});
