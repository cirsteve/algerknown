import type { KeychainProvider } from '../../src/auth/keychain-provider.js';

/** In-memory KeychainProvider fake: no real keychain is ever invoked in tests. */
export function createFakeKeychainProvider(seed: Record<string, string> = {}): KeychainProvider {
  const store = new Map<string, string>(Object.entries(seed));
  const key = (service: string, account: string) => `${service}::${account}`;

  return {
    name: 'fake',
    async get(service, account) {
      return store.get(key(service, account));
    },
    async set(service, account, secret) {
      store.set(key(service, account), secret);
    },
    async delete(service, account) {
      store.delete(key(service, account));
    },
  };
}
