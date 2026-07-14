import type { CommandRunner } from './command-runner.js';
import { createLinuxKeychainProvider } from './linux-keychain-provider.js';
import { createMacosKeychainProvider } from './macos-keychain-provider.js';
import { UnsupportedKeychainPlatformError, type KeychainProvider } from './keychain-provider.js';

/** Selects the tested keychain provider for the current platform; never falls back to a plaintext store. */
export function detectKeychainProvider(
  platform: NodeJS.Platform = process.platform,
  runner?: CommandRunner,
): KeychainProvider {
  switch (platform) {
    case 'darwin':
      return createMacosKeychainProvider(runner);
    case 'linux':
      return createLinuxKeychainProvider(runner);
    default:
      throw new UnsupportedKeychainPlatformError(platform);
  }
}
