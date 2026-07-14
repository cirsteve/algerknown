/** A platform keychain, storing one secret per (service, account) pair. */
export interface KeychainProvider {
  readonly name: string;
  get(service: string, account: string): Promise<string | undefined>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
}

export class UnsupportedKeychainPlatformError extends Error {
  constructor(platform: string) {
    super(
      `No supported OS keychain provider for platform "${platform}". Supported: macOS (security) and Linux (secret-tool). Set ALGERKNOWN_REVIEWER_SECRET instead of using the keychain on this platform.`,
    );
    this.name = 'UnsupportedKeychainPlatformError';
  }
}
