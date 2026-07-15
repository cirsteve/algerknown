import type { Request, Response, NextFunction } from 'express';
import type { GovernanceConfig } from './governance-config.js';

export type EnabledGovernanceConfig = Extract<GovernanceConfig, { enabled: true }>;

export interface OriginCheckInput {
  originHeader: string | undefined;
  hostHeader: string | undefined;
  forwardedHostHeader: string | undefined;
  remoteAddress: string | undefined;
  contentType: string | undefined;
  config: EnabledGovernanceConfig;
}

export type OriginCheckResult = { ok: true } | { ok: false; reason: string };

function expectedHost(publicOrigin: string): string {
  return new URL(publicOrigin).host.toLowerCase();
}

/** Strips the "::ffff:" prefix Node reports for IPv4 addresses on a dual-stack socket. */
function normalizeRemoteAddress(remoteAddress: string): string {
  return remoteAddress.startsWith('::ffff:') ? remoteAddress.slice('::ffff:'.length) : remoteAddress;
}

/**
 * Pure same-origin check for a browser-authenticated mutation: exact
 * Origin match, a Host (or, only from an explicitly trusted proxy, a
 * forwarded host) matching the configured public origin, and a JSON
 * content type. Missing, null, or mismatched origins are rejected.
 */
export function checkBrowserMutationOrigin(input: OriginCheckInput): OriginCheckResult {
  const { originHeader, hostHeader, forwardedHostHeader, remoteAddress, contentType, config } = input;

  if (!contentType || !contentType.toLowerCase().startsWith('application/json')) {
    return { ok: false, reason: 'content_type_rejected' };
  }

  if (!originHeader || originHeader === 'null') {
    return { ok: false, reason: 'origin_missing' };
  }
  if (originHeader.replace(/\/+$/, '') !== config.publicOrigin) {
    return { ok: false, reason: 'origin_mismatch' };
  }

  const normalizedRemoteAddress = remoteAddress ? normalizeRemoteAddress(remoteAddress) : undefined;
  const isTrustedProxy = !!normalizedRemoteAddress && config.trustedProxyHosts.includes(normalizedRemoteAddress);
  const effectiveHost = isTrustedProxy && forwardedHostHeader ? forwardedHostHeader : hostHeader;
  if (!effectiveHost || effectiveHost.toLowerCase() !== expectedHost(config.publicOrigin)) {
    return { ok: false, reason: 'host_mismatch' };
  }

  return { ok: true };
}

/** Express middleware enforcing checkBrowserMutationOrigin, rejecting with a generic 403. */
export function createBrowserMutationGuard(config: EnabledGovernanceConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = checkBrowserMutationOrigin({
      originHeader: req.headers.origin,
      hostHeader: req.headers.host,
      forwardedHostHeader: Array.isArray(req.headers['x-forwarded-host'])
        ? req.headers['x-forwarded-host'][0]
        : req.headers['x-forwarded-host'],
      remoteAddress: req.socket.remoteAddress,
      contentType: req.headers['content-type'],
      config,
    });
    if (!result.ok) {
      res.status(403).json({ error: 'request_rejected' });
      return;
    }
    next();
  };
}
