import { describe, expect, it } from 'vitest';
import { checkBrowserMutationOrigin, type EnabledGovernanceConfig } from '../../src/server/auth/origin-guard.js';
import { loadGovernanceConfig } from '../../src/server/auth/governance-config.js';

const REVIEWER_SECRET = 'r'.repeat(32);
const PROCESSOR_SECRET = 'p'.repeat(32);

function privateConfig(): EnabledGovernanceConfig {
  const config = loadGovernanceConfig({
    GOVERNANCE_REVIEWER_ID: 'steve',
    GOVERNANCE_REVIEWER_DISPLAY_NAME: 'Steve',
    GOVERNANCE_REVIEWER_SECRET: REVIEWER_SECRET,
    GOVERNANCE_PROCESSOR_ID: 'proc',
    GOVERNANCE_PROCESSOR_SECRET: PROCESSOR_SECRET,
    GOVERNANCE_PUBLIC_ORIGIN: 'https://agn.example.com',
    GOVERNANCE_PRIVATE_DEPLOYMENT: 'true',
    GOVERNANCE_TRUSTED_PROXY_HOSTS: '10.0.0.5',
  });
  if (!config.enabled) throw new Error('expected enabled config');
  return config;
}

describe('checkBrowserMutationOrigin', () => {
  it('matches a trusted proxy address given as a plain IPv4 literal', () => {
    const result = checkBrowserMutationOrigin({
      originHeader: 'https://agn.example.com',
      hostHeader: 'wrong-host-header.example.com',
      forwardedHostHeader: 'agn.example.com',
      remoteAddress: '10.0.0.5',
      contentType: 'application/json',
      config: privateConfig(),
    });
    expect(result.ok).toBe(true);
  });

  it('matches a trusted proxy address reported as an IPv6-mapped IPv4 address', () => {
    const result = checkBrowserMutationOrigin({
      originHeader: 'https://agn.example.com',
      hostHeader: 'wrong-host-header.example.com',
      forwardedHostHeader: 'agn.example.com',
      remoteAddress: '::ffff:10.0.0.5',
      contentType: 'application/json',
      config: privateConfig(),
    });
    expect(result.ok).toBe(true);
  });

  it('does not trust an untrusted remote address even with a forwarded host', () => {
    const result = checkBrowserMutationOrigin({
      originHeader: 'https://agn.example.com',
      hostHeader: 'wrong-host-header.example.com',
      forwardedHostHeader: 'agn.example.com',
      remoteAddress: '10.0.0.99',
      contentType: 'application/json',
      config: privateConfig(),
    });
    expect(result.ok).toBe(false);
  });
});
