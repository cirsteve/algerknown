import { describe, expect, it } from 'vitest';
import { resolveReviewerSecret, ReviewerSecretNotFoundError } from '../../src/auth/credential-resolver.js';
import { createFakeKeychainProvider } from '../fixtures/fake-keychain-provider.js';

describe('resolveReviewerSecret', () => {
  it('prefers ALGERKNOWN_REVIEWER_SECRET over the keychain', async () => {
    const keychainProvider = createFakeKeychainProvider({ 'algerknown-governance::steve': 'from-keychain' });
    const secret = await resolveReviewerSecret({
      env: { ALGERKNOWN_REVIEWER_SECRET: 'from-env', GOVERNANCE_REVIEWER_ID: 'steve' },
      keychainProvider,
    });
    expect(secret).toBe('from-env');
  });

  it('falls back to the keychain using GOVERNANCE_REVIEWER_ID as the account', async () => {
    const keychainProvider = createFakeKeychainProvider({ 'algerknown-governance::steve': 'from-keychain' });
    const secret = await resolveReviewerSecret({
      env: { GOVERNANCE_REVIEWER_ID: 'steve' },
      keychainProvider,
    });
    expect(secret).toBe('from-keychain');
  });

  it('falls back to ALGERKNOWN_REVIEWER_ID when GOVERNANCE_REVIEWER_ID is unset', async () => {
    const keychainProvider = createFakeKeychainProvider({ 'algerknown-governance::steve': 'from-keychain' });
    const secret = await resolveReviewerSecret({
      env: { ALGERKNOWN_REVIEWER_ID: 'steve' },
      keychainProvider,
    });
    expect(secret).toBe('from-keychain');
  });

  it('prefers GOVERNANCE_REVIEWER_ID over ALGERKNOWN_REVIEWER_ID when both are set', async () => {
    const keychainProvider = createFakeKeychainProvider({ 'algerknown-governance::correct-account': 'right' });
    const secret = await resolveReviewerSecret({
      env: { GOVERNANCE_REVIEWER_ID: 'correct-account', ALGERKNOWN_REVIEWER_ID: 'wrong-account' },
      keychainProvider,
    });
    expect(secret).toBe('right');
  });

  it('throws a concrete instruction when no account can be determined', async () => {
    const keychainProvider = createFakeKeychainProvider();
    await expect(resolveReviewerSecret({ env: {}, keychainProvider })).rejects.toBeInstanceOf(
      ReviewerSecretNotFoundError,
    );
  });

  it('throws a concrete instruction when the keychain has no entry for the account', async () => {
    const keychainProvider = createFakeKeychainProvider();
    await expect(
      resolveReviewerSecret({ env: { GOVERNANCE_REVIEWER_ID: 'steve' }, keychainProvider }),
    ).rejects.toThrow(/store-reviewer-secret/);
  });
});
