import { describe, expect, it } from 'vitest';
import { detectKeychainProvider } from '../../src/auth/detect-provider.js';
import { UnsupportedKeychainPlatformError } from '../../src/auth/keychain-provider.js';

describe('detectKeychainProvider', () => {
  it('selects the macOS provider on darwin', () => {
    const provider = detectKeychainProvider('darwin', async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(provider.name).toBe('macOS security');
  });

  it('selects the Linux provider on linux', () => {
    const provider = detectKeychainProvider('linux', async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(provider.name).toBe('Linux secret-tool');
  });

  it('throws an explicit unsupported-provider error on other platforms rather than writing plaintext', () => {
    expect(() => detectKeychainProvider('win32')).toThrow(UnsupportedKeychainPlatformError);
  });
});
