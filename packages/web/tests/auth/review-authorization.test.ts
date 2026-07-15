import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { REVIEW_ACTIONS } from '@algerknown/governed';
import { createGovernanceAuthRouter } from '../../src/server/routes/governance-auth.js';
import { createSessionRegistry } from '../../src/server/auth/session-registry.js';
import { createUnlockRateLimiter } from '../../src/server/auth/unlock-rate-limiter.js';
import { loadGovernanceConfig, type GovernanceConfig } from '../../src/server/auth/governance-config.js';
import { requireReviewerAuth } from '../../src/server/auth/reviewer-auth.js';
import { requireProcessorAuth } from '../../src/server/auth/processor-auth.js';
import { rejectClientSuppliedIdentityFields } from '../../src/server/auth/reject-identity-fields.js';
import type { EnabledGovernanceConfig } from '../../src/server/auth/origin-guard.js';
import type { GovernanceRuntime } from '../../src/server/auth/governance-runtime.js';
import { createTestClock } from '../fixtures/clock.js';

const ORIGIN = 'http://127.0.0.1:2393';
const REVIEWER_SECRET = 'r'.repeat(32);
const PROCESSOR_SECRET = 'p'.repeat(32);

function buildRuntime(): GovernanceRuntime {
  const clock = createTestClock();
  const config = loadGovernanceConfig({
    GOVERNANCE_REVIEWER_ID: 'steve',
    GOVERNANCE_REVIEWER_DISPLAY_NAME: 'Steve',
    GOVERNANCE_REVIEWER_SECRET: REVIEWER_SECRET,
    GOVERNANCE_PROCESSOR_ID: 'rag-processor',
    GOVERNANCE_PROCESSOR_SECRET: PROCESSOR_SECRET,
    GOVERNANCE_PUBLIC_ORIGIN: ORIGIN,
  });
  return {
    config,
    clock,
    sessionRegistry: createSessionRegistry({ clock }),
    unlockRateLimiter: createUnlockRateLimiter({ clock }),
  };
}

function enabledConfig(config: GovernanceConfig): EnabledGovernanceConfig {
  if (!config.enabled) throw new Error('expected enabled config');
  return config;
}

function buildApp(runtime: GovernanceRuntime) {
  const config = enabledConfig(runtime.config);
  const app = express();
  app.use(express.json());
  app.use('/api/governance/auth', createGovernanceAuthRouter(runtime));

  const reviewerAuth = requireReviewerAuth(config, runtime.sessionRegistry);
  for (const action of REVIEW_ACTIONS) {
    app.post(`/api/governance/proposals/:id/${action}`, reviewerAuth, rejectClientSuppliedIdentityFields, (req, res) => {
      res.status(200).json({ ok: true, action, reviewContext: res.locals.reviewContext });
    });
  }

  const processorAuth = requireProcessorAuth(config);
  app.post('/api/governance/proposals/propose', processorAuth, rejectClientSuppliedIdentityFields, (req, res) => {
    res.status(200).json({ ok: true, processorId: res.locals.processorId });
  });

  return app;
}

async function unlockAndGetCookieAndCsrf(app: express.Express) {
  const res = await request(app)
    .post('/api/governance/auth/unlock')
    .set('Origin', ORIGIN)
    .set('Host', '127.0.0.1:2393')
    .set('Content-Type', 'application/json')
    .send({ secret: REVIEWER_SECRET });
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  const cookieLine = setCookie.find((c) => c.startsWith('agn_governance_session='));
  const sessionToken = cookieLine?.split(';')[0]?.split('=')[1];
  return { sessionToken: sessionToken as string, csrfToken: res.body.csrfToken as string };
}

describe('review action authorization', () => {
  let runtime: GovernanceRuntime;
  let app: express.Express;

  beforeEach(() => {
    runtime = buildRuntime();
    app = buildApp(runtime);
  });

  it('authenticates a reviewer via CLI Bearer secret with a server-derived context', async () => {
    for (const action of REVIEW_ACTIONS) {
      const res = await request(app)
        .post(`/api/governance/proposals/p1/${action}`)
        .set('Authorization', `Bearer ${REVIEWER_SECRET}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.reviewContext).toEqual({
        reviewerId: 'steve',
        reviewerDisplayName: 'Steve',
        channel: 'cli',
      });
    }
  });

  it('authenticates a reviewer via browser cookie + CSRF with a server-derived context', async () => {
    const { sessionToken, csrfToken } = await unlockAndGetCookieAndCsrf(app);
    for (const action of REVIEW_ACTIONS) {
      const res = await request(app)
        .post(`/api/governance/proposals/p1/${action}`)
        .set('Origin', ORIGIN)
        .set('Host', '127.0.0.1:2393')
        .set('Content-Type', 'application/json')
        .set('Cookie', `agn_governance_session=${sessionToken}`)
        .set('X-Algerknown-CSRF', csrfToken)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.reviewContext).toEqual({
        reviewerId: 'steve',
        reviewerDisplayName: 'Steve',
        channel: 'browser',
      });
    }
  });

  it('denies processor credentials on every review action', async () => {
    for (const action of REVIEW_ACTIONS) {
      const res = await request(app)
        .post(`/api/governance/proposals/p1/${action}`)
        .set('Authorization', `Bearer ${PROCESSOR_SECRET}`)
        .send({});
      expect(res.status).toBe(401);
    }
  });

  it('denies a browser mutation without an Origin header on a review action', async () => {
    const { sessionToken, csrfToken } = await unlockAndGetCookieAndCsrf(app);
    const res = await request(app)
      .post('/api/governance/proposals/p1/accept')
      .set('Host', '127.0.0.1:2393')
      .set('Content-Type', 'application/json')
      .set('Cookie', `agn_governance_session=${sessionToken}`)
      .set('X-Algerknown-CSRF', csrfToken)
      .send({});
    expect(res.status).toBe(403);
  });

  it('denies a browser mutation with a missing or mismatched CSRF token', async () => {
    const { sessionToken } = await unlockAndGetCookieAndCsrf(app);
    const res = await request(app)
      .post('/api/governance/proposals/p1/accept')
      .set('Origin', ORIGIN)
      .set('Host', '127.0.0.1:2393')
      .set('Content-Type', 'application/json')
      .set('Cookie', `agn_governance_session=${sessionToken}`)
      .set('X-Algerknown-CSRF', 'wrong-csrf')
      .send({});
    expect(res.status).toBe(403);
  });

  it('allows the processor to propose', async () => {
    const res = await request(app)
      .post('/api/governance/proposals/propose')
      .set('Authorization', `Bearer ${PROCESSOR_SECRET}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.processorId).toBe('rag-processor');
  });

  it('denies a reviewer credential on the propose endpoint', async () => {
    const res = await request(app)
      .post('/api/governance/proposals/propose')
      .set('Authorization', `Bearer ${REVIEWER_SECRET}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('rejects client-supplied identity fields on a review action even with valid reviewer auth', async () => {
    const forbiddenBodies = [
      { reviewer_id: 'attacker' },
      { reviewer_name: 'Someone Else' },
      { timestamp: '2020-01-01T00:00:00Z' },
      { approved_at: '2020-01-01T00:00:00Z' },
      { channel: 'browser' },
      { mutation: { op: 'update' } },
      { mutation_hash: 'deadbeef' },
      { attestation: { id: 'a1' } },
      { evaluator_verdict: 'pass' },
    ];
    for (const body of forbiddenBodies) {
      const res = await request(app)
        .post('/api/governance/proposals/p1/accept')
        .set('Authorization', `Bearer ${REVIEWER_SECRET}`)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('rejects client-supplied identity fields on propose even with valid processor auth', async () => {
    const res = await request(app)
      .post('/api/governance/proposals/propose')
      .set('Authorization', `Bearer ${PROCESSOR_SECRET}`)
      .send({ reviewer_id: 'attacker' });
    expect(res.status).toBe(400);
  });
});
