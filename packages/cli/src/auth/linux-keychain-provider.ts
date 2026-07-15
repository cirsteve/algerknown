import { execCommandRunner, type CommandRunner } from './command-runner.js';
import { KeychainOperationError } from './keychain-errors.js';
import type { KeychainProvider } from './keychain-provider.js';

/**
 * Backed by `secret-tool` (libsecret/GNOME Keyring). Unlike the macOS
 * provider, `secret-tool store` reads the secret from stdin, so it never
 * appears as a process argument.
 */
export function createLinuxKeychainProvider(runner: CommandRunner = execCommandRunner): KeychainProvider {
  return {
    name: 'Linux secret-tool',

    async get(service, account) {
      const result = await runner('secret-tool', ['lookup', 'service', service, 'account', account]);
      if (result.code !== 0) return undefined;
      return result.stdout.replace(/\r?\n$/, '');
    },

    async set(service, account, secret) {
      const result = await runner(
        'secret-tool',
        ['store', '--label', `${service}:${account}`, 'service', service, 'account', account],
        secret,
      );
      if (result.code !== 0) throw new KeychainOperationError('set', 'Linux secret-tool', result.stderr);
    },

    async delete(service, account) {
      const result = await runner('secret-tool', ['clear', 'service', service, 'account', account]);
      if (result.code !== 0) throw new KeychainOperationError('delete', 'Linux secret-tool', result.stderr);
    },
  };
}
