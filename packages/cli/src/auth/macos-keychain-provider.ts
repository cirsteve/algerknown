import { execCommandRunner, type CommandRunner } from './command-runner.js';
import { KeychainOperationError } from './keychain-errors.js';
import type { KeychainProvider } from './keychain-provider.js';

/**
 * Backed by the macOS `security` CLI against the login keychain's generic
 * password store. `security find-generic-password` exits non-zero when the
 * item is absent (errSecItemNotFound), which we treat as "not found" rather
 * than an error.
 */
export function createMacosKeychainProvider(runner: CommandRunner = execCommandRunner): KeychainProvider {
  return {
    name: 'macOS security',

    async get(service, account) {
      const result = await runner('security', ['find-generic-password', '-s', service, '-a', account, '-w']);
      if (result.code !== 0) return undefined;
      return result.stdout.replace(/\r?\n$/, '');
    },

    async set(service, account, secret) {
      // security add-generic-password has no stdin form for -w; the secret
      // is passed as an argv value. -U updates the item if it already exists.
      const result = await runner('security', [
        'add-generic-password',
        '-s',
        service,
        '-a',
        account,
        '-w',
        secret,
        '-U',
      ]);
      if (result.code !== 0) throw new KeychainOperationError('set', 'macOS security', result.stderr);
    },

    async delete(service, account) {
      const result = await runner('security', ['delete-generic-password', '-s', service, '-a', account]);
      if (result.code !== 0) throw new KeychainOperationError('delete', 'macOS security', result.stderr);
    },
  };
}
