import { describe, expect, it } from 'vitest';
import { createMacosKeychainProvider } from '../../src/auth/macos-keychain-provider.js';
import { KeychainOperationError } from '../../src/auth/keychain-errors.js';
import type { CommandRunner } from '../../src/auth/command-runner.js';

function fakeRunner(handler: CommandRunner): CommandRunner {
  return handler;
}

describe('createMacosKeychainProvider', () => {
  it('get() runs security find-generic-password and trims the secret', async () => {
    let capturedArgs: string[] = [];
    const provider = createMacosKeychainProvider(
      fakeRunner(async (command, args) => {
        capturedArgs = args;
        expect(command).toBe('security');
        return { code: 0, stdout: 'super-secret\n', stderr: '' };
      }),
    );
    const secret = await provider.get('algerknown-governance', 'steve');
    expect(secret).toBe('super-secret');
    expect(capturedArgs).toEqual(['find-generic-password', '-s', 'algerknown-governance', '-a', 'steve', '-w']);
  });

  it('get() returns undefined when the item is not found', async () => {
    const provider = createMacosKeychainProvider(fakeRunner(async () => ({ code: 44, stdout: '', stderr: 'not found' })));
    expect(await provider.get('algerknown-governance', 'steve')).toBeUndefined();
  });

  it('set() runs security add-generic-password with -U to update in place', async () => {
    let capturedArgs: string[] = [];
    const provider = createMacosKeychainProvider(
      fakeRunner(async (_command, args) => {
        capturedArgs = args;
        return { code: 0, stdout: '', stderr: '' };
      }),
    );
    await provider.set('algerknown-governance', 'steve', 'my-secret');
    expect(capturedArgs).toEqual([
      'add-generic-password',
      '-s',
      'algerknown-governance',
      '-a',
      'steve',
      '-w',
      'my-secret',
      '-U',
    ]);
  });

  it('set() throws KeychainOperationError on failure', async () => {
    const provider = createMacosKeychainProvider(fakeRunner(async () => ({ code: 1, stdout: '', stderr: 'boom' })));
    await expect(provider.set('svc', 'acct', 'secret')).rejects.toBeInstanceOf(KeychainOperationError);
  });

  it('delete() runs security delete-generic-password', async () => {
    let capturedArgs: string[] = [];
    const provider = createMacosKeychainProvider(
      fakeRunner(async (_command, args) => {
        capturedArgs = args;
        return { code: 0, stdout: '', stderr: '' };
      }),
    );
    await provider.delete('algerknown-governance', 'steve');
    expect(capturedArgs).toEqual(['delete-generic-password', '-s', 'algerknown-governance', '-a', 'steve']);
  });

  it('delete() throws KeychainOperationError on failure', async () => {
    const provider = createMacosKeychainProvider(fakeRunner(async () => ({ code: 44, stdout: '', stderr: 'not found' })));
    await expect(provider.delete('svc', 'acct')).rejects.toBeInstanceOf(KeychainOperationError);
  });
});
