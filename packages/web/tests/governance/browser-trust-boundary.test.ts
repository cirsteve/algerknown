import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { asActorId, asEdgeId, asIdempotencyKey, asNodeId, asProcessorId, type WriteCommand } from '@algerknown/governed';
import { namespaceForBinding, subjectForBinding } from '@algerknown/governed/adapters/algerknown';
import { loadGovernanceConfig } from '../../src/server/auth/governance-config.js';
import { createSessionRegistry } from '../../src/server/auth/session-registry.js';
import { createUnlockRateLimiter } from '../../src/server/auth/unlock-rate-limiter.js';
import type { GovernanceRuntime } from '../../src/server/auth/governance-runtime.js';
import { createGovernanceAuthRouter } from '../../src/server/routes/governance-auth.js';
import { createGovernanceRouter } from '../../src/server/routes/governance.js';
import { createGovernanceComposition, type GovernanceComposition } from '../../src/server/governance/index.js';
import { createTestClock } from '../fixtures/clock.js';
import { seedKnowledgeBase, writeNamespaceBindings, testEnv, cleanup, type SeededKnowledgeBase } from './fixtures.js';
import { recordSuiteEvidence, trackSuiteFailures } from './evidence-helpers.js';

const REVIEWER_SECRET = 'r'.repeat(32);
const PROCESSOR_SECRET = 'p'.repeat(32);

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

/**
 * EC7 (web case): reviewer bearer, browser cookie/CSRF, and processor
 * propose-only trust properties, exercised through the real router and a
 * real composition -- not auth unit tests in isolation.
 */
describe('EC7: browser cookie/CSRF and processor propose-only trust boundary', () => {
  let kb: SeededKnowledgeBase | undefined;
  let env: NodeJS.ProcessEnv | undefined;
  let composition: GovernanceComposition | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    composition?.close();
    if (kb && env) cleanup(kb, env);
  });

  // Origin/Host validation requires the Origin header to exactly match
  // config.publicOrigin *and* the Host header to match its host:port -- so
  // the app must be bound to a real port *before* the config (and thus the
  // origin every request needs to send) can be constructed, unlike a plain
  // supertest(app) which would create its own ephemeral server on a
  // different, unpredictable port.
  async function buildApp(composition: GovernanceComposition): Promise<{ origin: string }> {
    const app = express();
    app.use(express.json());
    server = app.listen(0);
    await new Promise((resolve) => server!.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;

    const config = loadGovernanceConfig({
      GOVERNANCE_REVIEWER_ID: 'steve',
      GOVERNANCE_REVIEWER_DISPLAY_NAME: 'Steve',
      GOVERNANCE_REVIEWER_SECRET: REVIEWER_SECRET,
      GOVERNANCE_PROCESSOR_ID: 'test-processor',
      GOVERNANCE_PROCESSOR_SECRET: PROCESSOR_SECRET,
      GOVERNANCE_PUBLIC_ORIGIN: origin,
    });
    const clock = createTestClock();
    const runtime: GovernanceRuntime = { config, clock, sessionRegistry: createSessionRegistry({ clock }), unlockRateLimiter: createUnlockRateLimiter({ clock }) };
    app.use('/api/governance/auth', createGovernanceAuthRouter(runtime));
    app.use('/api/governance', createGovernanceRouter(runtime, composition));
    return { origin };
  }

  it('unlocks a browser session, requires matching CSRF and Origin for a mutation, and attributes the accepted event to channel "browser"', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });
    const { origin } = await buildApp(composition);

    const proposeOutcome = await composition.proposalService.propose({
      mutation: proposeCommand(kb, 'fact-browser-1', 'edge-browser-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-browser-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
    const proposalId = proposeOutcome.proposal.id;

    const unlockRes = await request(server).post('/api/governance/auth/unlock').set('Origin', origin).send({ secret: REVIEWER_SECRET });
    expect(unlockRes.status).toBe(200);
    const cookie = unlockRes.headers['set-cookie']![0]!;
    const csrfToken = unlockRes.body.csrfToken as string;
    expect(csrfToken.length).toBeGreaterThan(0);

    // -- Missing CSRF header: rejected, nothing applied.
    const noCsrf = await request(server)
      .post(`/api/governance/proposals/${proposalId}/accept`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-browser-nocsrf' });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error).toBe('csrf_rejected');

    // -- Wrong Origin: rejected before session/CSRF is even consulted.
    const wrongOrigin = await request(server)
      .post(`/api/governance/proposals/${proposalId}/accept`)
      .set('Cookie', cookie)
      .set('Origin', 'http://evil.example.com')
      .set('x-algerknown-csrf', csrfToken)
      .send({ expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-browser-wrongorigin' });
    expect(wrongOrigin.status).toBe(403);
    expect(wrongOrigin.body.error).toBe('request_rejected');

    expect((await composition.proposalService.getProposal(proposalId))?.status).toBe('pending');

    // -- Correct cookie + CSRF + Origin: succeeds, and the accepted event's
    // actor is the *server-derived* session reviewer, on channel "browser".
    const accepted = await request(server)
      .post(`/api/governance/proposals/${proposalId}/accept`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('x-algerknown-csrf', csrfToken)
      .send({ expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-browser-ok' });
    expect(accepted.status).toBe(200);

    const inspection = await composition.proposalService.inspect(proposalId);
    const acceptedEvent = inspection.events.find((e) => e.kind === 'accepted')!;
    expect(acceptedEvent.channel).toBe('browser');
    expect(String(acceptedEvent.actorId)).toBe('steve');
  });

  it('a processor bearer credential is denied on reviewer-only routes (propose-only boundary)', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });
    composition = await createGovernanceComposition({ env });
    const { origin } = await buildApp(composition);

    const listRes = await request(server).get('/api/governance/proposals').set('Authorization', `Bearer ${PROCESSOR_SECRET}`);
    expect(listRes.status).toBe(401);

    const proposeOutcome = await composition.proposalService.propose({
      mutation: proposeCommand(kb, 'fact-proc-deny-1', 'edge-proc-deny-1'),
      supportingObservationIds: [],
      idempotencyKey: 'propose-proc-deny-1',
    });
    if (proposeOutcome.outcome !== 'created') throw new Error('expected created');

    const acceptRes = await request(server)
      .post(`/api/governance/proposals/${proposeOutcome.proposal.id}/accept`)
      .set('Authorization', `Bearer ${PROCESSOR_SECRET}`)
      .send({ expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'accept-proc-deny-1' });
    expect(acceptRes.status).toBe(401);
    expect((await composition.proposalService.getProposal(proposeOutcome.proposal.id))?.status).toBe('pending');

    // Contrast: the *reviewer* secret works on the exact same route.
    const reviewerListRes = await request(server).get('/api/governance/proposals').set('Authorization', `Bearer ${REVIEWER_SECRET}`);
    expect(reviewerListRes.status).toBe(200);
  });

  it('records ec7-authenticated-boundary evidence (web case) once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'ec7-authenticated-boundary',
      caseId: 'web',
      suite: 'packages/web/tests/governance/browser-trust-boundary.test.ts',
      fixture: 'real router + real composition: cookie/CSRF/Origin mutation guard, processor-bearer-denied-on-reviewer-route',
      backend: 'algerknown',
      durationMs: Date.now() - suiteStart,
    });
  });
});
