import type { Request, Response, NextFunction } from 'express';
import { secretMatches } from './secrets.js';
import type { EnabledGovernanceConfig } from './origin-guard.js';

declare module 'express-serve-static-core' {
  interface Locals {
    processorId?: string;
  }
}

const BEARER_PREFIX = 'Bearer ';

function bearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) return undefined;
  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Authenticates the propose-only processor via Bearer secret. Compares
 * only against the configured processor secret (never the reviewer
 * secret) and never reads a cookie. Must be mounted only on the
 * proposal-ingest route - never on review-action or reviewer-session
 * routes, per the Phase 2 least-privilege boundary.
 */
export function requireProcessorAuth(config: EnabledGovernanceConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req.headers.authorization);
    if (!token || !secretMatches(token, config.processor.secret)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    res.locals.processorId = config.processor.id;
    next();
  };
}
