import { detectKeychainProvider } from './detect-provider.js';
import type { KeychainProvider } from './keychain-provider.js';

export const KEYCHAIN_SERVICE = 'algerknown-governance';

export class ReviewerSecretNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewerSecretNotFoundError';
  }
}

export interface ResolveReviewerSecretOptions {
  env?: NodeJS.ProcessEnv;
  keychainProvider?: KeychainProvider;
}

function resolveAccount(env: NodeJS.ProcessEnv): string | undefined {
  const account = env.GOVERNANCE_REVIEWER_ID ?? env.ALGERKNOWN_REVIEWER_ID;
  return account && account.trim().length > 0 ? account.trim() : undefined;
}

/**
 * Resolves the CLI reviewer secret: ALGERKNOWN_REVIEWER_SECRET first, then
 * the OS keychain under service "algerknown-governance" and an account of
 * GOVERNANCE_REVIEWER_ID/ALGERKNOWN_REVIEWER_ID. Never reads a plaintext
 * dotfile; fails with a concrete instruction when neither resolves.
 */
export async function resolveReviewerSecret(opts: ResolveReviewerSecretOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;

  const fromEnv = env.ALGERKNOWN_REVIEWER_SECRET;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }

  const account = resolveAccount(env);
  if (!account) {
    throw new ReviewerSecretNotFoundError(
      'No reviewer secret found: set ALGERKNOWN_REVIEWER_SECRET, or set GOVERNANCE_REVIEWER_ID (or ALGERKNOWN_REVIEWER_ID) and run `agn auth store-reviewer-secret`.',
    );
  }

  const provider = opts.keychainProvider ?? detectKeychainProvider();
  const secret = await provider.get(KEYCHAIN_SERVICE, account);
  if (!secret) {
    throw new ReviewerSecretNotFoundError(
      `No reviewer secret found for account "${account}" in the ${provider.name} keychain. Run \`agn auth store-reviewer-secret\` to store one, or set ALGERKNOWN_REVIEWER_SECRET.`,
    );
  }
  return secret;
}
