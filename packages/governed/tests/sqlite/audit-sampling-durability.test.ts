import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { asActorId, asIdempotencyKey, asNamespaceId, asNodeId, asProcessorId, asSubjectId, type GovernedConfig, type WriteCommand } from '../../src/index.js';
import { DEFAULT_GOVERNED_CONFIG } from '../../src/config/governed-config.js';
import { createProposalsTestHarness } from '../proposals/harness.js';
import { recordSuiteEvidence, trackSuiteFailures } from '../acceptance/evidence-helpers.js';

const NAMESPACE = asNamespaceId('memory.community.audit-durability');
const PROCESSOR = asProcessorId('audit-processor-1');

function observationCommand(nodeId: string, i: number): WriteCommand {
  return {
    namespace: NAMESPACE,
    subject: asSubjectId('subject-1'),
    nodeMutations: [{ op: 'create', nodeId: asNodeId(nodeId), nodeType: 'observation', payload: { description: `observation ${i}` }, confidence: 0.8 }],
    edgeMutations: [],
    expectedNamespaceRevision: i === 0 ? null : i,
    idempotencyKey: asIdempotencyKey(`audit-idem-${i}`),
    actorId: asActorId('audit-actor-1'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }], processorId: PROCESSOR },
  };
}

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

describe('INV3: deterministic audit sampling is durable across a real database reopen', () => {
  it('sampled revisions, pending state, and reviewer attribution all survive close + reopen, including after the sampled node is later corrected', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governed-audit-durability-'));
    const dbPath = path.join(dir, 'governed.db');
    const config: GovernedConfig = { ...DEFAULT_GOVERNED_CONFIG, auditPolicy: { defaultEvery: 2, perProcessorEvery: {}, perNamespaceEvery: {} } };

    // -- Write 4 revisions against a real file. Every-2 sampling selects
    // revisions 2 and 4 deterministically (see rail-matrix.test.ts's
    // "deterministic audit sampling" case for the same [false, true, false,
    // true] pattern against an in-memory backend).
    let harness = createProposalsTestHarness(dbPath, config, 'before-reopen');
    let orchestrator = harness.orchestrator;
    const sampledFlags: (boolean | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      const result = await orchestrator.write(observationCommand(`n-${i}`, i));
      expect(result.outcome).toBe('applied');
      sampledFlags.push(result.outcome === 'applied' ? result.auditDirective?.sampled : undefined);
    }
    expect(sampledFlags).toEqual([false, true, false, true]);

    const pendingBeforeClose = await harness.service.pendingAuditSamples(NAMESPACE);
    expect(pendingBeforeClose).toHaveLength(2);
    expect(pendingBeforeClose.map((s) => s.namespaceRevision).sort((a, b) => a - b)).toEqual([2, 4]);
    const sampleToReview = pendingBeforeClose.find((s) => s.namespaceRevision === 2)!;

    // -- Review one of the two samples, then close the database entirely.
    const reviewedSample = await harness.service.markAuditSampleReviewed(sampleToReview.sampleId, {
      reviewerId: asActorId('auditor-1'),
      verdict: 'confirmed',
      note: 'Spot check passed.',
      at: harness.clock.now(),
    });
    expect(reviewedSample.reviewed).toBe(true);
    harness.connection.close();

    // -- Reopen against the exact same file with a brand-new harness
    // instance (nothing carried over in memory).
    harness = createProposalsTestHarness(dbPath, config, 'after-reopen');
    orchestrator = harness.orchestrator;

    const stillPending = await harness.service.pendingAuditSamples(NAMESPACE);
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0]!.namespaceRevision).toBe(4);

    const allSamplesAfterReopen = harness.connection.db.prepare('SELECT * FROM audit_samples ORDER BY namespace_revision ASC').all() as {
      namespace_revision: number;
      reviewed: number;
      reviewer_id: string | null;
      verdict: string | null;
      note: string | null;
    }[];
    expect(allSamplesAfterReopen).toHaveLength(2);
    expect(allSamplesAfterReopen[0]).toMatchObject({ namespace_revision: 2, reviewed: 1, reviewer_id: 'auditor-1', verdict: 'confirmed', note: 'Spot check passed.' });
    expect(allSamplesAfterReopen[1]).toMatchObject({ namespace_revision: 4, reviewed: 0 });

    // -- Correcting the *already-reviewed* sampled node (revision 2) with a
    // new write must not remove or renumber its standing audit sample --
    // audit history is immutable once recorded.
    const correction = await orchestrator.write({
      ...observationCommand('n-1', 4),
      nodeMutations: [{ op: 'update', nodeId: asNodeId('n-1'), payload: { description: 'corrected observation' } }],
      idempotencyKey: asIdempotencyKey('audit-idem-correction'),
    });
    expect(correction.outcome).toBe('applied');

    const samplesAfterCorrection = harness.connection.db.prepare('SELECT namespace_revision, reviewed FROM audit_samples ORDER BY namespace_revision ASC').all();
    expect(samplesAfterCorrection).toEqual([
      { namespace_revision: 2, reviewed: 1 },
      { namespace_revision: 4, reviewed: 0 },
    ]);

    harness.connection.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records inv3-audit-sampling-durable evidence once the scenario above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'inv3-audit-sampling-durable',
      suite: 'packages/governed/tests/sqlite/audit-sampling-durability.test.ts',
      fixture: 'deterministic every-2 audit sampling against a real sqlite file, close + reopen, then a correcting write',
      backend: 'sqlite',
      durationMs: Date.now() - suiteStart,
    });
  });
});
