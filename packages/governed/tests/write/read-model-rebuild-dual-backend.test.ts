import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOVERNED_CONFIG,
  ReferenceReadModel,
  SqliteRepository,
  WriteOrchestrator,
  asActorId,
  asAttestationId,
  asEdgeId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asProcessorId,
  asSubjectId,
  normalizeWriteCommand,
  openGovernedDatabase,
  rebuildReferenceReadModel,
  type Repository,
  type WriteCommand,
} from '../../src/index.js';
import { GitAlgerknownRepository, namespaceForBinding, subjectForBinding, type DossierBinding } from '../../src/adapters/algerknown/index.js';
import { seedFixtureRepo } from '../fixtures/algerknown/loader.js';
import { createTestClock } from '../fixtures/clock.js';
import { createTestIdGenerator } from '../fixtures/id-generator.js';
import { InMemoryProposalRepository } from '../fixtures/proposal-repository.js';
import { InMemoryOperationSink } from '../fixtures/operation-sink.js';
import { StubProcessor } from '../fixtures/processor.js';
import { ConfigurableContradictionDetector } from '../fixtures/contradiction-detector.js';
import { InMemoryUsageCounter } from '../fixtures/usage-counter.js';
import { StubAttestationVerifier } from '../fixtures/attestation-verifier.js';
import { recordSuiteEvidence, trackSuiteFailures } from '../acceptance/evidence-helpers.js';

/**
 * Builds the live ReferenceReadModel incrementally as each write lands,
 * captures its rows/digest, then -- as a wholly separate instance, never
 * seeded from the live one -- rebuilds solely from
 * `repository.listRevisionsSince(namespace, 0)` and asserts byte-identical
 * rows/digest with an empty diff. `rebuildReferenceReadModel` always
 * constructs `new ReferenceReadModel()` internally, so this genuinely proves
 * "drop all projection state and rebuild from the system of record," not
 * "rebuild from a copied snapshot."
 */
async function assertRebuildMatchesLive(repository: Repository, namespace: ReturnType<typeof asNamespaceId>) {
  const live = new ReferenceReadModel();
  for (const record of await repository.listRevisionsSince(namespace, 0)) {
    live.ingestRevision(record);
  }
  const liveRows = live.rows(namespace);
  const liveDigest = await live.digest(namespace);
  expect(liveRows.length).toBeGreaterThan(0);

  const rebuilt = await rebuildReferenceReadModel(repository, namespace);

  const rowDiff = JSON.stringify(liveRows) === JSON.stringify(rebuilt.rows) ? [] : ['rows differ'];
  expect(rowDiff).toEqual([]);
  expect(rebuilt.rows).toEqual(liveRows);
  expect(rebuilt.digest).toBe(liveDigest);
}

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

describe('EC5: read-model rebuild is byte-identical from governed revision enumeration', () => {
  it('sqlite-backed namespace: rebuild matches the live projection exactly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governed-rebuild-sqlite-'));
    const connection = openGovernedDatabase({ filename: path.join(dir, 'governed.db') });
    connection.migrate();
    const repository = new SqliteRepository(connection.db);
    const namespace = asNamespaceId('memory.community.rebuild-demo');
    const orchestrator = new WriteOrchestrator({
      config: DEFAULT_GOVERNED_CONFIG,
      repository,
      proposalRepository: new InMemoryProposalRepository(),
      operationSink: new InMemoryOperationSink(),
      processor: new StubProcessor(),
      contradictionDetector: new ConfigurableContradictionDetector(),
      attestationVerifier: new StubAttestationVerifier(),
      usageCounter: new InMemoryUsageCounter(),
      clock: createTestClock(),
      idGenerator: createTestIdGenerator('rebuild-sqlite'),
    });

    for (let i = 0; i < 3; i++) {
      const result = await orchestrator.write({
        namespace,
        subject: asSubjectId('rebuild-subject'),
        nodeMutations: [{ op: 'create', nodeId: asNodeId(`n-${i}`), nodeType: 'observation', payload: { description: `observation ${i}` }, confidence: 0.8 }],
        edgeMutations: [],
        expectedNamespaceRevision: i === 0 ? null : i,
        idempotencyKey: asIdempotencyKey(`idem-${i}`),
        actorId: asActorId('processor-1'),
        actorClass: 'processor',
        provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }], processorId: asProcessorId('processor-1') },
      } satisfies WriteCommand);
      expect(result.outcome).toBe('applied');
    }

    await assertRebuildMatchesLive(repository, namespace);
    connection.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('algerknown git-backed namespace: rebuild matches the live projection exactly', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'governed-rebuild-git-'));
    fs.rmSync(repoRoot, { recursive: true, force: true });
    seedFixtureRepo(repoRoot);
    const binding: DossierBinding = { projectKey: 'agent-evals', summaryId: 'agent-evals-dossier', path: 'summaries/agent-evals-dossier.yaml' };
    const repository = new GitAlgerknownRepository({ repoRoot, binding });
    const namespace = namespaceForBinding(binding);
    const subject = subjectForBinding(binding);

    const proposalRepository = new InMemoryProposalRepository();
    const attestationVerifier = new StubAttestationVerifier();
    const idGenerator = createTestIdGenerator('rebuild-git');
    const clock = createTestClock();
    const orchestrator = new WriteOrchestrator({
      config: DEFAULT_GOVERNED_CONFIG,
      repository,
      proposalRepository,
      operationSink: new InMemoryOperationSink(),
      processor: new StubProcessor(),
      contradictionDetector: new ConfigurableContradictionDetector(),
      attestationVerifier,
      usageCounter: new InMemoryUsageCounter(),
      clock,
      idGenerator,
    });

    async function proposeAndAccept(command: WriteCommand) {
      const { command: normalized, mutationHash } = normalizeWriteCommand(command);
      const proposalId = idGenerator.nextProposalId();
      const attestationId = idGenerator.nextAttestationId();
      await proposalRepository.save({
        id: proposalId,
        canonicalMutation: normalized,
        mutationHash,
        targetNamespace: normalized.namespace,
        targetSubject: normalized.subject,
        expectedTargetRevision: normalized.expectedNamespaceRevision,
        supportingObservationIds: [],
        provenance: { sources: [], railId: 'human-gated', evaluatorVerdicts: [] },
        version: 1,
        status: 'pending',
        events: [],
      });
      attestationVerifier.register({
        id: attestationId,
        reviewerId: asActorId('rebuild-reviewer'),
        approvedAt: clock.now(),
        proposalId,
        proposalVersion: 1,
        targetRevision: normalized.expectedNamespaceRevision,
        mutationHash,
        channel: 'rebuild-suite',
        verifierMeta: {},
      });
      const result = await orchestrator.write({ ...command, attestation: { attestationId } });
      expect(result.outcome).toBe('applied');
    }

    for (let i = 0; i < 3; i++) {
      await proposeAndAccept({
        namespace,
        subject,
        nodeMutations: [
          { op: 'create', nodeId: asNodeId(`fact-rebuild-${i}`), nodeType: 'fact', payload: { statement: `Rebuild fact ${i}.`, attributes: { status: 'shipped', safe_phrasings: [`Rebuild fact ${i}.`] } }, confidence: 1 },
        ],
        edgeMutations: [
          { op: 'create', edgeId: asEdgeId(`rebuild-edge-${i}`), kind: 'evidence_for', sourceId: asNodeId('evidence-jig-ideation-entry'), targetId: asNodeId(`fact-rebuild-${i}`) },
        ],
        expectedNamespaceRevision: i === 0 ? null : i,
        idempotencyKey: asIdempotencyKey(`idem-rebuild-${i}`),
        actorId: asActorId('processor-1'),
        actorClass: 'processor',
        provenanceInput: { sources: [{ kind: 'external', id: 'evidence-jig-ideation-entry' }] },
      });
    }

    await assertRebuildMatchesLive(repository, namespace);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('records ec5-read-model-rebuild evidence once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'ec5-read-model-rebuild',
      caseId: 'sqlite',
      suite: 'packages/governed/tests/write/read-model-rebuild-dual-backend.test.ts',
      fixture: 'ReferenceReadModel drop-and-rebuild against SqliteRepository',
      backend: 'sqlite',
      durationMs: Date.now() - suiteStart,
    });
    recordSuiteEvidence(suiteHealth, {
      checkId: 'ec5-read-model-rebuild',
      caseId: 'algerknown',
      suite: 'packages/governed/tests/write/read-model-rebuild-dual-backend.test.ts',
      fixture: 'ReferenceReadModel drop-and-rebuild against GitAlgerknownRepository seeded from the pinned cohort-1 fixture',
      backend: 'algerknown',
      durationMs: Date.now() - suiteStart,
    });
  });
});
