import { Router, type Request, type Response } from 'express';
import { buildClearSessionCookie, buildSessionCookie, parseSessionCookie } from '../auth/cookies.js';
import type { GovernanceRuntime } from '../auth/governance-runtime.js';
import { createBrowserMutationGuard } from '../auth/origin-guard.js';
import { secretMatches } from '../auth/secrets.js';

const SESSION_TTL_SECONDS = 30 * 60;
const CSRF_HEADER = 'x-algerknown-csrf';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** True only when body is a plain object containing exactly the given key with a non-empty string value. */
function extractSoleStringField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Same-origin JSON-only unlock/session/logout routes for the browser
 * governance trust profile. Requires an enabled GovernanceConfig; callers
 * (server bootstrap, tests) must only mount this when governance is
 * configured.
 */
export function createGovernanceAuthRouter(runtime: GovernanceRuntime): Router {
  const { config } = runtime;
  if (!config.enabled) {
    throw new Error('createGovernanceAuthRouter requires an enabled GovernanceConfig');
  }

  const router = Router();
  const isSecureCookie = config.publicOrigin.toLowerCase().startsWith('https://');
  const mutationGuard = createBrowserMutationGuard(config);

  router.post('/unlock', mutationGuard, (req: Request, res: Response) => {
    const remoteAddress = req.socket.remoteAddress ?? 'unknown';
    if (runtime.unlockRateLimiter.isBlocked(remoteAddress)) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    const secret = extractSoleStringField(req.body, 'secret');
    if (!secret || !secretMatches(secret, config.reviewer.secret)) {
      runtime.unlockRateLimiter.registerFailure(remoteAddress);
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    runtime.unlockRateLimiter.registerSuccess(remoteAddress);
    const issued = runtime.sessionRegistry.issue({
      id: config.reviewer.id,
      displayName: config.reviewer.displayName,
    });
    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(issued.sessionToken, { secure: isSecureCookie, maxAgeSeconds: SESSION_TTL_SECONDS }),
    );
    res.status(200).json({
      reviewer: issued.reviewer,
      expiresAt: issued.expiresAt,
      csrfToken: issued.csrfToken,
    });
  });

  router.get('/session', (req: Request, res: Response) => {
    const sessionToken = parseSessionCookie(req.headers.cookie);
    const record = sessionToken ? runtime.sessionRegistry.validate(sessionToken) : undefined;
    if (!sessionToken || !record) {
      res.status(401).json({ error: 'session_invalid' });
      return;
    }
    const csrfToken = runtime.sessionRegistry.rotateCsrf(sessionToken);
    if (!csrfToken) {
      res.status(401).json({ error: 'session_invalid' });
      return;
    }
    res.status(200).json({ reviewer: record.reviewer, expiresAt: record.expiresAt, csrfToken });
  });

  router.post('/logout', mutationGuard, (req: Request, res: Response) => {
    const sessionToken = parseSessionCookie(req.headers.cookie);
    if (sessionToken) {
      const record = runtime.sessionRegistry.validate(sessionToken);
      if (record) {
        const suppliedCsrf = firstHeaderValue(req.headers[CSRF_HEADER]);
        if (!suppliedCsrf || !runtime.sessionRegistry.verifyCsrf(sessionToken, suppliedCsrf)) {
          res.status(403).json({ error: 'csrf_rejected' });
          return;
        }
      }
      runtime.sessionRegistry.destroy(sessionToken);
    }
    res.setHeader('Set-Cookie', buildClearSessionCookie({ secure: isSecureCookie }));
    res.status(200).json({ ok: true });
  });

  return router;
}
