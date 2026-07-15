import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asActorId, asIdempotencyKey, asNamespaceId, asNodeId, asProcessorId, asSubjectId } from '@algerknown/governed';
import { loadGovernanceConfig } from '../../src/server/auth/governance-config.js';
import { createSessionRegistry } from '../../src/server/auth/session-registry.js';
import { createUnlockRateLimiter } from '../../src/server/auth/unlock-rate-limiter.js';
import type { GovernanceRuntime } from '../../src/server/auth/governance-runtime.js';
import { createGovernanceRouter } from '../../src/server/routes/governance.js';
import { createGovernanceComposition, type GovernanceComposition } from '../../src/server/governance/index.js';
import { createTestClock } from '../fixtures/clock.js';
import { seedKnowledgeBase, writeNamespaceBindings, cleanup, type SeededKnowledgeBase } from './fixtures.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ORIGIN = 'http://127.0.0.1:2393';
const REVIEWER_SECRET = 'r'.repeat(32);
const PROCESSOR_SECRET = 'p'.repeat(32);

async function buildFixtures(): Promise<{ runtime: GovernanceRuntime; composition: GovernanceComposition; app: express.Express; kb: SeededKnowledgeBase; env: NodeJS.ProcessEnv }> {
  const kb = seedKnowledgeBase();
  writeNamespaceBindings(kb.root, [kb.binding]);
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-routes-db-'));
  const env: NodeJS.ProcessEnv = {
    GOVERNANCE_REVIEWER_ID: 'steve',
    GOVERNANCE_REVIEWER_DISPLAY_NAME: 'Steve',
    GOVERNANCE_REVIEWER_SECRET: REVIEWER_SECRET,
    GOVERNANCE_PROCESSOR_ID: 'rag-processor',
    GOVERNANCE_PROCESSOR_SECRET: PROCESSOR_SECRET,
    GOVERNANCE_PUBLIC_ORIGIN: ORIGIN,
    ALGERKNOWN_ROOT: kb.root,
    GOVERNANCE_DB_PATH: path.join(dbDir, 'governed.sqlite'),
  };

  const clock = createTestClock();
  const config = loadGovernanceConfig(env);
  const runtime: GovernanceRuntime = {
    config,
    clock,
    sessionRegistry: createSessionRegistry({ clock }),
    unlockRateLimiter: createUnlockRateLimiter({ clock }),
  };
  const composition = await createGovernanceComposition({ env, clock });

  const app = express();
  app.use(express.json());
  app.use('/api/governance', createGovernanceRouter(runtime, composition));

  return { runtime, composition, app, kb, env };
}

describe('governance HTTP API', () => {
  let composition: GovernanceComposition;
  let app: express.Express;
  let kb: SeededKnowledgeBase;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    ({ composition, app, kb, env } = await buildFixtures());
  });

  afterEach(() => {
    composition.close();
    cleanup(kb, env);
  });

  function processorRequest() {
    return {
      post: (url: string) => request(app).post(url).set('Authorization', `Bearer ${PROCESSOR_SECRET}`),
    };
  }
  function reviewerRequest() {
    return {
      get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${REVIEWER_SECRET}`),
      post: (url: string) => request(app).post(url).set('Authorization', `Bearer ${REVIEWER_SECRET}`),
    };
  }

  it('lets a processor persist a generic proposal but not accept it', async () => {
    const proposeRes = await processorRequest()
      .post('/api/governance/processor/proposals')
      .send({
        sourceEntryId: 'entry-1',
        targetSummaryId: 'demo-dossier',
        confidence: 0.8,
        processorVersion: '1.0.0',
        newLearnings: [{ insight: 'The demo pipeline is fast.' }],
        idempotencyKey: 'job-1:candidate-0:hash-abc',
      });

    // The source entry doesn't exist in the fixture yet -- expect a 404 for
    // an unknown entry rather than a silently-accepted fabricated proposal.
    expect(proposeRes.status).toBe(404);

    // Seed the source entry the candidate references.
    fs.mkdirSync(path.join(kb.root, 'entries'), { recursive: true });
    fs.writeFileSync(
      path.join(kb.root, 'entries', 'entry-1.yaml'),
      'id: entry-1\ntype: entry\ndate: "2026-01-01"\ntopic: Demo entry\nstatus: active\n',
      'utf-8',
    );
    const indexPath = path.join(kb.root, 'index.yaml');
    const index = fs.readFileSync(indexPath, 'utf-8');
    fs.writeFileSync(indexPath, `${index}  entry-1:\n    path: entries/entry-1.yaml\n    type: entry\n`, 'utf-8');

    const created = await processorRequest()
      .post('/api/governance/processor/proposals')
      .send({
        sourceEntryId: 'entry-1',
        targetSummaryId: 'demo-dossier',
        confidence: 0.8,
        processorVersion: '1.0.0',
        newLearnings: [{ insight: 'The demo pipeline is fast.' }],
        idempotencyKey: 'job-1:candidate-0:hash-abc',
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('created');
    const proposalId = created.body.proposalId as string;

    // Processor credentials must never authorize accept.
    const acceptAttempt = await processorRequest()
      .post(`/api/governance/proposals/${proposalId}/accept`)
      .send({ expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-1' });
    expect(acceptAttempt.status).toBe(401);

    // The proposal is still readable and pending for a reviewer.
    const detail = await reviewerRequest().get(`/api/governance/proposals/${proposalId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('pending');
  });

  it('rejects a strict-schema violation with 400 before any auth-independent processing', async () => {
    const res = await processorRequest()
      .post('/api/governance/processor/proposals')
      .send({ sourceEntryId: 'x', targetSummaryId: 'y', confidence: 1, processorVersion: '1', idempotencyKey: 'k', extraField: 'nope' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid queue cursor with 400 instead of 500', async () => {
    const res = await reviewerRequest().get('/api/governance/proposals?cursor=not-a-valid-cursor');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('reviewer can list, inspect, and accept a proposal end to end', async () => {
    fs.mkdirSync(path.join(kb.root, 'entries'), { recursive: true });
    fs.writeFileSync(
      path.join(kb.root, 'entries', 'entry-2.yaml'),
      'id: entry-2\ntype: entry\ndate: "2026-01-01"\ntopic: Demo entry two\nstatus: active\n',
      'utf-8',
    );
    const indexPath = path.join(kb.root, 'index.yaml');
    fs.writeFileSync(indexPath, `${fs.readFileSync(indexPath, 'utf-8')}  entry-2:\n    path: entries/entry-2.yaml\n    type: entry\n`, 'utf-8');

    const created = await processorRequest().post('/api/governance/processor/proposals').send({
      sourceEntryId: 'entry-2',
      targetSummaryId: 'demo-dossier',
      confidence: 0.9,
      processorVersion: '1.0.0',
      newDecisions: [{ decision: 'Use the demo pipeline.' }],
      idempotencyKey: 'job-2:candidate-0:hash-def',
    });
    expect(created.status).toBe(201);
    const proposalId = created.body.proposalId as string;

    const queue = await reviewerRequest().get('/api/governance/proposals?status=pending');
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((item: { id: string }) => item.id === proposalId)).toBe(true);

    const accept = await reviewerRequest()
      .post(`/api/governance/proposals/${proposalId}/accept`)
      .send({ expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-2' });
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe('accepted');

    const detail = await reviewerRequest().get(`/api/governance/proposals/${proposalId}`);
    expect(detail.body.status).toBe('accepted');
  });

  it('returns 409 with current version on a stale accept', async () => {
    fs.mkdirSync(path.join(kb.root, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(kb.root, 'entries', 'entry-3.yaml'), 'id: entry-3\ntype: entry\ndate: "2026-01-01"\ntopic: T\nstatus: active\n', 'utf-8');
    const indexPath = path.join(kb.root, 'index.yaml');
    fs.writeFileSync(indexPath, `${fs.readFileSync(indexPath, 'utf-8')}  entry-3:\n    path: entries/entry-3.yaml\n    type: entry\n`, 'utf-8');

    const created = await processorRequest().post('/api/governance/processor/proposals').send({
      sourceEntryId: 'entry-3',
      targetSummaryId: 'demo-dossier',
      confidence: 0.9,
      processorVersion: '1.0.0',
      newOpenQuestions: ['Is this fast enough?'],
      idempotencyKey: 'job-3:candidate-0:hash-ghi',
    });
    const proposalId = created.body.proposalId as string;

    const acceptStale = await reviewerRequest()
      .post(`/api/governance/proposals/${proposalId}/accept`)
      .send({ expectedVersion: 99, expectedTargetRevision: null, idempotencyKey: 'accept-stale' });
    expect(acceptStale.status).toBe(409);
    expect(acceptStale.body.error).toBe('version_conflict');
  });

  it('returns a stable 503 when an amendment targets an unavailable repository engine', async () => {
    const proposed = await composition.proposalService.propose({
      mutation: {
        namespace: asNamespaceId('canonical.project.unbound'),
        subject: asSubjectId('subject-unbound'),
        nodeMutations: [
          {
            op: 'create',
            nodeId: asNodeId('fact-unbound-1'),
            nodeType: 'fact',
            payload: { statement: 'This proposal has no configured dossier binding.' },
            confidence: 0.9,
          },
        ],
        edgeMutations: [],
        expectedNamespaceRevision: null,
        idempotencyKey: asIdempotencyKey('write-unbound-1'),
        actorId: asActorId('rag-processor'),
        actorClass: 'processor',
        provenanceInput: {
          sources: [{ kind: 'external', id: 'source-unbound-1' }],
          processorId: asProcessorId('rag-processor'),
          processorVersion: '1.0.0',
        },
      },
      supportingObservationIds: [],
      idempotencyKey: 'propose-unbound-1',
    });
    if (proposed.outcome !== 'created') throw new Error('expected created proposal');

    const response = await reviewerRequest()
      .post(`/api/governance/proposals/${proposed.proposal.id}/amend`)
      .send({
        expectedVersion: 1,
        expectedTargetRevision: null,
        patch: [],
        note: 'Attempt to refresh the unbound target.',
        idempotencyKey: 'amend-unbound-1',
      });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      error: 'repository_unavailable',
      message: expect.stringContaining('no dossier binding is configured'),
    });
  });

  it('POST /processor/operations records a generic append-only telemetry event, idempotently, without creating a reviewable proposal', async () => {
    const first = await processorRequest()
      .post('/api/governance/processor/operations')
      .send({ subject: 'algerknown.entry:entry-ops-1:ingest', description: 'Ingested entry entry-ops-1', idempotencyKey: 'ingest:job-ops-1:entry-ops-1' });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('recorded');
    expect(first.body.resultingRevision).toBe(1);

    // Exact replay is idempotent -- no second revision, no error.
    const replay = await processorRequest()
      .post('/api/governance/processor/operations')
      .send({ subject: 'algerknown.entry:entry-ops-1:ingest', description: 'Ingested entry entry-ops-1', idempotencyKey: 'ingest:job-ops-1:entry-ops-1' });
    expect(replay.status).toBe(200);
    expect(replay.body.resultingRevision).toBe(1);

    // Never appears in the reviewer proposal queue -- it was never a proposal.
    const queue = await reviewerRequest().get('/api/governance/proposals?limit=50');
    expect((queue.body.items as { id: string }[]).length).toBe(0);

    // A reviewer bearer credential cannot record an operation event either --
    // this is a processor-only route, symmetric with propose-only.
    const asReviewer = await reviewerRequest()
      .post('/api/governance/processor/operations')
      .send({ subject: 'algerknown.entry:entry-ops-2:ingest', description: 'Ingested entry entry-ops-2', idempotencyKey: 'ingest:job-ops-1:entry-ops-2' });
    expect(asReviewer.status).toBe(401);
  });
});
