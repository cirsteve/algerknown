import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGovernanceAuthRouter } from '../../src/server/routes/governance-auth.js';
import { createSessionRegistry } from '../../src/server/auth/session-registry.js';
import { createUnlockRateLimiter } from '../../src/server/auth/unlock-rate-limiter.js';
import { loadGovernanceConfig } from '../../src/server/auth/governance-config.js';
import type { GovernanceRuntime } from '../../src/server/auth/governance-runtime.js';
import { createTestClock } from '../fixtures/clock.js';

const ORIGIN = 'http://127.0.0.1:2393';
const REVIEWER_SECRET = 'r'.repeat(32);

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    GOVERNANCE_REVIEWER_ID: 'steve',
    GOVERNANCE_REVIEWER_DISPLAY_NAME: 'Steve',
    GOVERNANCE_REVIEWER_SECRET: REVIEWER_SECRET,
    GOVERNANCE_PROCESSOR_ID: 'rag-processor',
    GOVERNANCE_PROCESSOR_SECRET: 'p'.repeat(32),
    GOVERNANCE_PUBLIC_ORIGIN: ORIGIN,
    ...overrides,
  };
}

function buildApp(runtime: GovernanceRuntime) {
  const app = express();
  app.use(express.json());
  app.use('/api/governance/auth', createGovernanceAuthRouter(runtime));
  return app;
}

function buildRuntime(envOverrides: Record<string, string | undefined> = {}, clock = createTestClock()) {
  const config = loadGovernanceConfig(baseEnv(envOverrides));
  return {
    config,
    clock,
    sessionRegistry: createSessionRegistry({ clock }),
    unlockRateLimiter: createUnlockRateLimiter({ clock }),
  } satisfies GovernanceRuntime;
}

function unlockRequest(app: express.Express, secret: string, overrides: Partial<Record<string, string>> = {}) {
  return request(app)
    .post('/api/governance/auth/unlock')
    .set('Origin', overrides.origin ?? ORIGIN)
    .set('Host', overrides.host ?? '127.0.0.1:2393')
    .set('Content-Type', 'application/json')
    .send({ secret });
}

function extractCookieValue(setCookieHeader: string[], name: string): string | undefined {
  const line = setCookieHeader.find((c) => c.startsWith(`${name}=`));
  if (!line) return undefined;
  return line.split(';')[0]?.split('=')[1];
}

describe('governance auth routes', () => {
  let runtime: ReturnType<typeof buildRuntime>;
  let app: express.Express;

  beforeEach(() => {
    runtime = buildRuntime();
    app = buildApp(runtime);
  });

  it('unlock succeeds with the correct secret and sets a hardened session cookie', async () => {
    const res = await unlockRequest(app, REVIEWER_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.reviewer).toEqual({ id: 'steve', displayName: 'Steve' });
    expect(typeof res.body.csrfToken).toBe('string');

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie).toBeDefined();
    const cookieLine = setCookie.find((c) => c.startsWith('agn_governance_session='));
    expect(cookieLine).toBeDefined();
    expect(cookieLine).toContain('HttpOnly');
    expect(cookieLine).toContain('SameSite=Strict');
    expect(cookieLine).toContain('Path=/api/governance');
    expect(cookieLine).toContain('Max-Age=1800');
    expect(cookieLine).not.toContain('Secure');
  });

  it('unlock fails with a generic 401 for a wrong secret', async () => {
    const res = await unlockRequest(app, 'wrong-secret-wrong-secret-wrong');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_credentials' });
  });

  it('unlock rejects a body with extra fields', async () => {
    const res = await request(app)
      .post('/api/governance/auth/unlock')
      .set('Origin', ORIGIN)
      .set('Host', '127.0.0.1:2393')
      .set('Content-Type', 'application/json')
      .send({ secret: REVIEWER_SECRET, reviewer_id: 'someone-else' });
    expect(res.status).toBe(401);
  });

  it('rejects unlock missing the Origin header', async () => {
    const res = await request(app)
      .post('/api/governance/auth/unlock')
      .set('Host', '127.0.0.1:2393')
      .set('Content-Type', 'application/json')
      .send({ secret: REVIEWER_SECRET });
    expect(res.status).toBe(403);
  });

  it('rejects unlock with a mismatched Origin header', async () => {
    const res = await unlockRequest(app, REVIEWER_SECRET, { origin: 'http://evil.example.com' });
    expect(res.status).toBe(403);
  });

  it('rejects unlock with a mismatched Host header', async () => {
    const res = await unlockRequest(app, REVIEWER_SECRET, { host: 'evil.example.com' });
    expect(res.status).toBe(403);
  });

  it('rate-limits unlock to five failures per rolling minute per remote address', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await unlockRequest(app, 'wrong');
      expect(res.status).toBe(401);
    }
    const blocked = await unlockRequest(app, REVIEWER_SECRET);
    expect(blocked.status).toBe(429);
  });

  it('session lookup validates a cookie and rotates the CSRF token each call', async () => {
    const unlockRes = await unlockRequest(app, REVIEWER_SECRET);
    const setCookie = unlockRes.headers['set-cookie'] as unknown as string[];
    const sessionToken = extractCookieValue(setCookie, 'agn_governance_session');

    const first = await request(app).get('/api/governance/auth/session').set('Cookie', `agn_governance_session=${sessionToken}`);
    expect(first.status).toBe(200);
    expect(first.body.reviewer).toEqual({ id: 'steve', displayName: 'Steve' });

    const second = await request(app).get('/api/governance/auth/session').set('Cookie', `agn_governance_session=${sessionToken}`);
    expect(second.status).toBe(200);
    expect(second.body.csrfToken).not.toBe(first.body.csrfToken);
  });

  it('session lookup fails without a cookie', async () => {
    const res = await request(app).get('/api/governance/auth/session');
    expect(res.status).toBe(401);
  });

  it('logout requires a matching CSRF token and clears the cookie on success', async () => {
    const unlockRes = await unlockRequest(app, REVIEWER_SECRET);
    const setCookie = unlockRes.headers['set-cookie'] as unknown as string[];
    const sessionToken = extractCookieValue(setCookie, 'agn_governance_session');
    const csrfToken = unlockRes.body.csrfToken as string;

    const rejected = await request(app)
      .post('/api/governance/auth/logout')
      .set('Origin', ORIGIN)
      .set('Host', '127.0.0.1:2393')
      .set('Content-Type', 'application/json')
      .set('Cookie', `agn_governance_session=${sessionToken}`)
      .set('X-Algerknown-CSRF', 'wrong-token')
      .send({});
    expect(rejected.status).toBe(403);

    const accepted = await request(app)
      .post('/api/governance/auth/logout')
      .set('Origin', ORIGIN)
      .set('Host', '127.0.0.1:2393')
      .set('Content-Type', 'application/json')
      .set('Cookie', `agn_governance_session=${sessionToken}`)
      .set('X-Algerknown-CSRF', csrfToken)
      .send({});
    expect(accepted.status).toBe(200);
    const clearCookie = (accepted.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('agn_governance_session='),
    );
    expect(clearCookie).toContain('Max-Age=0');

    const afterLogout = await request(app)
      .get('/api/governance/auth/session')
      .set('Cookie', `agn_governance_session=${sessionToken}`);
    expect(afterLogout.status).toBe(401);
  });

  it('enforces absolute session expiry using the injected clock', async () => {
    const clock = createTestClock();
    runtime = buildRuntime({}, clock);
    app = buildApp(runtime);

    const unlockRes = await unlockRequest(app, REVIEWER_SECRET);
    const setCookie = unlockRes.headers['set-cookie'] as unknown as string[];
    const sessionToken = extractCookieValue(setCookie, 'agn_governance_session');

    clock.advanceMs(30 * 60 * 1000 + 1);

    const res = await request(app).get('/api/governance/auth/session').set('Cookie', `agn_governance_session=${sessionToken}`);
    expect(res.status).toBe(401);
  });

  it('a fresh runtime (simulating a server restart) invalidates prior sessions', async () => {
    const unlockRes = await unlockRequest(app, REVIEWER_SECRET);
    const setCookie = unlockRes.headers['set-cookie'] as unknown as string[];
    const sessionToken = extractCookieValue(setCookie, 'agn_governance_session');

    const restartedRuntime = buildRuntime();
    const restartedApp = buildApp(restartedRuntime);
    const res = await request(restartedApp)
      .get('/api/governance/auth/session')
      .set('Cookie', `agn_governance_session=${sessionToken}`);
    expect(res.status).toBe(401);
  });

  it('sets the Secure cookie attribute for an HTTPS public origin', async () => {
    const httpsRuntime = buildRuntime({
      GOVERNANCE_PUBLIC_ORIGIN: 'https://agn.example.com',
      GOVERNANCE_PRIVATE_DEPLOYMENT: 'true',
      GOVERNANCE_TRUSTED_PROXY_HOSTS: '10.0.0.5',
    });
    const httpsApp = buildApp(httpsRuntime);
    const res = await request(httpsApp)
      .post('/api/governance/auth/unlock')
      .set('Origin', 'https://agn.example.com')
      .set('Host', 'agn.example.com')
      .set('Content-Type', 'application/json')
      .send({ secret: REVIEWER_SECRET });

    expect(res.status).toBe(200);
    const cookieLine = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('agn_governance_session='),
    );
    expect(cookieLine).toContain('Secure');
  });
});
