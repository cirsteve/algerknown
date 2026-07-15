import type { Request, Response, NextFunction } from 'express';
import { asActorId, type AuthenticatedReviewContext } from '@algerknown/governed';
import type { SessionRegistry } from './session-registry.js';
import { parseSessionCookie } from './cookies.js';
import { secretMatches } from './secrets.js';
import { checkBrowserMutationOrigin, type EnabledGovernanceConfig } from './origin-guard.js';

const CSRF_HEADER = 'x-algerknown-csrf';
const BEARER_PREFIX = 'Bearer ';

function bearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) return undefined;
  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

declare module 'express-serve-static-core' {
  interface Locals {
    reviewContext?: AuthenticatedReviewContext;
  }
}

/**
 * Authenticates a reviewer for a review-action route via either a CLI
 * Bearer secret (channel 'cli') or a browser session cookie plus CSRF
 * token (channel 'browser'), and attaches a server-derived
 * AuthenticatedReviewContext to res.locals.reviewContext. Bearer tokens
 * are compared only to the configured reviewer secret, so a processor
 * credential can never authenticate here.
 */
export function requireReviewerAuth(config: EnabledGovernanceConfig, sessionRegistry: SessionRegistry) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req.headers.authorization);
    if (token !== undefined) {
      if (!secretMatches(token, config.reviewer.secret)) {
        res.status(401).json({ error: 'invalid_credentials' });
        return;
      }
      res.locals.reviewContext = {
        reviewerId: asActorId(config.reviewer.id),
        reviewerDisplayName: config.reviewer.displayName,
        channel: 'cli',
      };
      next();
      return;
    }

    // The strict Origin/Host/Content-Type check exists to stop a forged
    // cross-site *mutation* from riding the session cookie -- it does not
    // apply to safe (GET/HEAD) reads: browsers do not send an Origin header
    // on a same-origin GET at all (only on unsafe methods and cross-origin
    // requests), so requiring its presence here would reject every real
    // browser read, not just forged ones. Reads still require a valid
    // session cookie and CSRF token below, and the session cookie itself
    // (HttpOnly, SameSite=Strict) is never sent cross-site by the browser.
    const isSafeMethod = req.method === 'GET' || req.method === 'HEAD';
    if (!isSafeMethod) {
      const originResult = checkBrowserMutationOrigin({
        originHeader: req.headers.origin,
        hostHeader: req.headers.host,
        forwardedHostHeader: firstHeaderValue(req.headers['x-forwarded-host']),
        remoteAddress: req.socket.remoteAddress,
        contentType: req.headers['content-type'],
        config,
      });
      if (!originResult.ok) {
        res.status(403).json({ error: 'request_rejected' });
        return;
      }
    }

    const sessionToken = parseSessionCookie(req.headers.cookie);
    const record = sessionToken ? sessionRegistry.validate(sessionToken) : undefined;
    if (!sessionToken || !record) {
      res.status(401).json({ error: 'session_invalid' });
      return;
    }

    const suppliedCsrf = firstHeaderValue(req.headers[CSRF_HEADER]);
    if (!suppliedCsrf || !sessionRegistry.verifyCsrf(sessionToken, suppliedCsrf)) {
      res.status(403).json({ error: 'csrf_rejected' });
      return;
    }

    res.locals.reviewContext = {
      reviewerId: asActorId(record.reviewer.id),
      reviewerDisplayName: record.reviewer.displayName,
      channel: 'browser',
    };
    next();
  };
}
