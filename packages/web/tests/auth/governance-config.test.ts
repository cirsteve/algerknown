import { describe, expect, it } from 'vitest';
import { GovernanceConfigError, loadGovernanceConfig } from '../../src/server/auth/governance-config.js';

const REVIEWER_SECRET = 'r'.repeat(32);
const PROCESSOR_SECRET = 'p'.repeat(32);

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    GOVERNANCE_REVIEWER_ID: 'steve',
    GOVERNANCE_REVIEWER_DISPLAY_NAME: 'Steve',
    GOVERNANCE_REVIEWER_SECRET: REVIEWER_SECRET,
    GOVERNANCE_PROCESSOR_ID: 'rag-processor',
    GOVERNANCE_PROCESSOR_SECRET: PROCESSOR_SECRET,
    GOVERNANCE_PUBLIC_ORIGIN: 'http://127.0.0.1:2393',
    ...overrides,
  };
}

describe('loadGovernanceConfig', () => {
  it('is disabled when no governance variables are set', () => {
    const config = loadGovernanceConfig({});
    expect(config.enabled).toBe(false);
  });

  it('loads a valid loopback configuration', () => {
    const config = loadGovernanceConfig(baseEnv());
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error('unreachable');
    expect(config.reviewer).toEqual({ id: 'steve', displayName: 'Steve', secret: REVIEWER_SECRET });
    expect(config.processor).toEqual({ id: 'rag-processor', secret: PROCESSOR_SECRET });
    expect(config.publicOrigin).toBe('http://127.0.0.1:2393');
    expect(config.privateDeployment).toBe(false);
    expect(config.trustedProxyHosts).toEqual([]);
  });

  it('fails closed when only some governance variables are set', () => {
    expect(() => loadGovernanceConfig({ GOVERNANCE_REVIEWER_ID: 'steve' })).toThrow(GovernanceConfigError);
  });

  it('rejects a reviewer secret below the minimum length', () => {
    expect(() => loadGovernanceConfig(baseEnv({ GOVERNANCE_REVIEWER_SECRET: 'too-short' }))).toThrow(
      /at least 32 bytes long/,
    );
  });

  it('rejects a processor secret below the minimum length', () => {
    expect(() => loadGovernanceConfig(baseEnv({ GOVERNANCE_PROCESSOR_SECRET: 'too-short' }))).toThrow(
      /at least 32 bytes long/,
    );
  });

  it('rejects an empty display name', () => {
    expect(() => loadGovernanceConfig(baseEnv({ GOVERNANCE_REVIEWER_DISPLAY_NAME: '   ' }))).toThrow(
      GovernanceConfigError,
    );
  });

  it('rejects a wildcard public origin', () => {
    expect(() => loadGovernanceConfig(baseEnv({ GOVERNANCE_PUBLIC_ORIGIN: '*' }))).toThrow(/wildcard/);
  });

  it('rejects a comma-separated public origin list', () => {
    expect(() =>
      loadGovernanceConfig(baseEnv({ GOVERNANCE_PUBLIC_ORIGIN: 'https://a.example,https://b.example' })),
    ).toThrow(/wildcard|comma/);
  });

  it('rejects a non-loopback origin without GOVERNANCE_PRIVATE_DEPLOYMENT', () => {
    expect(() => loadGovernanceConfig(baseEnv({ GOVERNANCE_PUBLIC_ORIGIN: 'https://agn.example.com' }))).toThrow(
      /loopback/,
    );
  });

  it('accepts a non-loopback HTTPS origin when private deployment is explicitly enabled with trusted proxies', () => {
    const config = loadGovernanceConfig(
      baseEnv({
        GOVERNANCE_PUBLIC_ORIGIN: 'https://agn.example.com',
        GOVERNANCE_PRIVATE_DEPLOYMENT: 'true',
        GOVERNANCE_TRUSTED_PROXY_HOSTS: '10.0.0.5',
      }),
    );
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error('unreachable');
    expect(config.privateDeployment).toBe(true);
    expect(config.trustedProxyHosts).toEqual(['10.0.0.5']);
  });

  it('rejects private deployment with an HTTP origin', () => {
    expect(() =>
      loadGovernanceConfig(
        baseEnv({
          GOVERNANCE_PUBLIC_ORIGIN: 'http://agn.example.com',
          GOVERNANCE_PRIVATE_DEPLOYMENT: 'true',
          GOVERNANCE_TRUSTED_PROXY_HOSTS: '10.0.0.5',
        }),
      ),
    ).toThrow(/HTTPS/);
  });

  it('rejects private deployment without explicit trusted proxy hosts', () => {
    expect(() =>
      loadGovernanceConfig(
        baseEnv({
          GOVERNANCE_PUBLIC_ORIGIN: 'https://agn.example.com',
          GOVERNANCE_PRIVATE_DEPLOYMENT: 'true',
        }),
      ),
    ).toThrow(/trusted_proxy/i);
  });
});
