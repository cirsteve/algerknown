import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asNamespaceId, asSubjectId, openGovernedDatabase, SqliteRepository } from '../../src/index.js';
import type { DatabaseType } from '../../src/sqlite/connection.js';
import { canonicalStringify, contentHash } from '../../src/sqlite/canonical.js';
import { createTestClock } from '../fixtures/clock.js';
import { createTestIdGenerator } from '../fixtures/id-generator.js';
import { StubAttestationVerifier } from '../fixtures/attestation-verifier.js';
import { runRepositoryConformanceSuite } from './repository-conformance.js';
import { recordSuiteEvidence, trackSuiteFailures } from '../acceptance/evidence-helpers.js';
import { describe, it } from 'vitest';

const NAMESPACE = asNamespaceId('canonical.project.sqlite-conformance');
const SUBJECT = asSubjectId('sqlite-conformance-subject');

interface SqliteContext {
  dbPath: string;
  dir: string;
}

/**
 * Seeds fixture nodes directly into current_nodes, bypassing the
 * orchestrator entirely, so the conformance suite finds pre-existing
 * "evidence" and "fact" records the same way the git adapter's fixture finds
 * pre-existing dossier evidence/facts -- and, matching that fixture, seeds
 * no `namespaces` row, so getNamespaceRevision(...) is still null before any
 * governed write (see "reads" case in repository-conformance.ts).
 */
function seedNode(db: DatabaseType, opts: { nodeId: string; type: string; payload: Record<string, unknown> }): void {
  const revision = { revisionId: 'seed-revision', namespaceRevision: 0, createdAt: '2026-01-01T00:00:00.000Z', actorId: 'seed', actorClass: 'human' };
  const provenance = { sources: [], railId: 'seed', evaluatorVerdicts: [] };
  db.prepare(
    `INSERT INTO current_nodes
       (namespace, node_id, type, subject, payload_json, confidence, provenance_json, revision_json, content_hash, namespace_revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    NAMESPACE,
    opts.nodeId,
    opts.type,
    SUBJECT,
    canonicalStringify(opts.payload),
    1,
    canonicalStringify(provenance),
    canonicalStringify(revision),
    contentHash({ id: opts.nodeId, type: opts.type, payload: opts.payload }),
    0,
  );
}

runRepositoryConformanceSuite<SqliteContext>({
  seedFixture: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governed-sqlite-conformance-'));
    const dbPath = path.join(dir, 'governed.db');
    const connection = openGovernedDatabase({ filename: dbPath });
    connection.migrate();
    seedNode(connection.db, { nodeId: 'evidence-1', type: 'resource', payload: { locator: 'https://example.com/evidence-1' } });
    seedNode(connection.db, { nodeId: 'evidence-2', type: 'resource', payload: { locator: 'https://example.com/evidence-2' } });
    seedNode(connection.db, { nodeId: 'fact-seed-1', type: 'fact', payload: { statement: 'A seeded fact.', attributes: { status: 'shipped', safe_phrasings: ['A seeded fact.'] } } });
    connection.close();

    return {
      context: { dbPath, dir },
      fixture: { namespace: NAMESPACE, subject: SUBJECT, evidenceId: 'evidence-1', alternateEvidenceId: 'evidence-2', factId: 'fact-seed-1' },
    };
  },
  createRepository: (context) => {
    const connection = openGovernedDatabase({ filename: context.dbPath });
    connection.migrate();
    return new SqliteRepository(connection.db);
  },
  teardown: (context) => {
    fs.rmSync(context.dir, { recursive: true, force: true });
  },
  createClock: () => createTestClock(),
  createIdGenerator: () => createTestIdGenerator('sqlite-conf'),
  createAttestationVerifier: () => new StubAttestationVerifier(),
  // No simulateCrashMidWrite: SQLite's own transaction boundary (BEGIN
  // IMMEDIATE / COMMIT / ROLLBACK in SqliteRepository.commit) already
  // guarantees a write is fully applied or fully absent -- there is no
  // partial-write state for a fresh Repository instance to self-heal from,
  // unlike the git adapter's two-step (commit, then materialize) sequence.
  // The failure-recovery case below is therefore legitimately skipped here;
  // EC6 (restart & crash recovery) covers the real non-ACID coordination
  // surface -- the web composition's git+sqlite intent ledger -- directly.
});

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

describe('sqlite conformance: acceptance evidence', () => {
  it('records the sqlite case of ec3-backend-conformance once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'ec3-backend-conformance',
      caseId: 'sqlite',
      suite: 'packages/governed/tests/conformance/sqlite.conformance.test.ts',
      fixture: 'runRepositoryConformanceSuite against SqliteRepository seeded with evidence/fact nodes',
      backend: 'sqlite',
      durationMs: Date.now() - suiteStart,
    });
  });
});
