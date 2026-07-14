const MIN_SECRET_BYTES = 32;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface ReviewerConfig {
  id: string;
  displayName: string;
  secret: string;
}

export interface ProcessorConfig {
  id: string;
  secret: string;
}

export type GovernanceConfig =
  | { enabled: false }
  | {
      enabled: true;
      reviewer: ReviewerConfig;
      processor: ProcessorConfig;
      publicOrigin: string;
      privateDeployment: boolean;
      trustedProxyHosts: string[];
    };

export class GovernanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GovernanceConfigError';
  }
}

const GOVERNANCE_ENV_KEYS = [
  'GOVERNANCE_REVIEWER_ID',
  'GOVERNANCE_REVIEWER_DISPLAY_NAME',
  'GOVERNANCE_REVIEWER_SECRET',
  'GOVERNANCE_PROCESSOR_ID',
  'GOVERNANCE_PROCESSOR_SECRET',
] as const;

function isSet(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireNonEmpty(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!isSet(value)) {
    throw new GovernanceConfigError(`${key} must be a non-empty value when governance is enabled`);
  }
  return value.trim();
}

/**
 * Enforces a minimum UTF-8 byte length only - this is a length floor, not
 * an actual entropy measurement (it can't detect a long but predictable
 * value). Operators are expected to supply a securely random secret, e.g.
 * via `openssl rand -hex 32`.
 */
function requireMinEntropySecret(env: NodeJS.ProcessEnv, key: string): string {
  const value = requireNonEmpty(env, key);
  if (Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES) {
    throw new GovernanceConfigError(
      `${key} must be at least ${MIN_SECRET_BYTES} bytes long, generated from a secure random source (e.g. \`openssl rand -hex ${MIN_SECRET_BYTES}\`) - length alone is checked here, not actual randomness`,
    );
  }
  return value;
}

function normalizeOrigin(rawOrigin: string): string {
  return rawOrigin.trim().replace(/\/+$/, '');
}

function parseOriginHost(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new GovernanceConfigError(`GOVERNANCE_PUBLIC_ORIGIN "${origin}" is not a valid absolute origin`);
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new GovernanceConfigError('GOVERNANCE_PUBLIC_ORIGIN must not include a path');
  }
  return parsed.hostname.toLowerCase();
}

function parseTrustedProxyHosts(raw: string | undefined): string[] {
  if (!isSet(raw)) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Loads and validates the Phase 2 single-operator trust profile from the
 * environment. Fails closed: if any governance variable is set, every
 * required field must be present and every secret must meet the minimum
 * length floor (a proxy for entropy, not a measurement of it - operators
 * still must supply a securely random secret), or startup throws instead
 * of running unauthenticated.
 */
export function loadGovernanceConfig(env: NodeJS.ProcessEnv = process.env): GovernanceConfig {
  const anyConfigured = GOVERNANCE_ENV_KEYS.some((key) => isSet(env[key]));
  if (!anyConfigured) {
    return { enabled: false };
  }

  const reviewer: ReviewerConfig = {
    id: requireNonEmpty(env, 'GOVERNANCE_REVIEWER_ID'),
    displayName: requireNonEmpty(env, 'GOVERNANCE_REVIEWER_DISPLAY_NAME'),
    secret: requireMinEntropySecret(env, 'GOVERNANCE_REVIEWER_SECRET'),
  };
  const processor: ProcessorConfig = {
    id: requireNonEmpty(env, 'GOVERNANCE_PROCESSOR_ID'),
    secret: requireMinEntropySecret(env, 'GOVERNANCE_PROCESSOR_SECRET'),
  };

  const privateDeployment = (env.GOVERNANCE_PRIVATE_DEPLOYMENT ?? '').trim().toLowerCase() === 'true';
  const rawOrigin = env.GOVERNANCE_PUBLIC_ORIGIN;
  if (!isSet(rawOrigin)) {
    throw new GovernanceConfigError('GOVERNANCE_PUBLIC_ORIGIN must be a non-empty value when governance is enabled');
  }
  if (rawOrigin.includes(',') || rawOrigin.trim() === '*') {
    throw new GovernanceConfigError(
      'GOVERNANCE_PUBLIC_ORIGIN must be a single explicit origin, not a wildcard or comma-separated list',
    );
  }

  const publicOrigin = normalizeOrigin(rawOrigin);
  const originHost = parseOriginHost(publicOrigin);
  const isHttps = publicOrigin.toLowerCase().startsWith('https://');
  const trustedProxyHosts = parseTrustedProxyHosts(env.GOVERNANCE_TRUSTED_PROXY_HOSTS);

  if (privateDeployment) {
    if (!isHttps) {
      throw new GovernanceConfigError('GOVERNANCE_PUBLIC_ORIGIN must be an explicit HTTPS origin when GOVERNANCE_PRIVATE_DEPLOYMENT=true');
    }
    if (trustedProxyHosts.length === 0) {
      throw new GovernanceConfigError(
        'GOVERNANCE_TRUSTED_PROXY_HOSTS must list explicit proxy addresses when GOVERNANCE_PRIVATE_DEPLOYMENT=true',
      );
    }
  } else if (!LOOPBACK_HOSTS.has(originHost)) {
    throw new GovernanceConfigError(
      `GOVERNANCE_PUBLIC_ORIGIN host "${originHost}" is not loopback; set GOVERNANCE_PRIVATE_DEPLOYMENT=true for a non-loopback deployment`,
    );
  }

  return {
    enabled: true,
    reviewer,
    processor,
    publicOrigin,
    privateDeployment,
    trustedProxyHosts,
  };
}
