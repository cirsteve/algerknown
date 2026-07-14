import { describe, expect, it } from 'vitest';
import { createLinuxKeychainProvider } from '../../src/auth/linux-keychain-provider.js';
import { KeychainOperationError } from '../../src/auth/keychain-errors.js';
import type { CommandRunner } from '../../src/auth/command-runner.js';

describe('createLinuxKeychainProvider', () => {
  it('get() runs secret-tool lookup and trims the secret', async () => {
    let capturedArgs: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      capturedArgs = args;
      expect(command).toBe('secret-tool');
      return { code: 0, stdout: 'super-secret\n', stderr: '' };
    };
    const provider = createLinuxKeychainProvider(runner);
    const secret = await provider.get('algerknown-governance', 'steve');
    expect(secret).toBe('super-secret');
    expect(capturedArgs).toEqual(['lookup', 'service', 'algerknown-governance', 'account', 'steve']);
  });

  it('get() returns undefined when the item is not found', async () => {
    const runner: CommandRunner = async () => ({ code: 1, stdout: '', stderr: 'No such secret' });
    const provider = createLinuxKeychainProvider(runner);
    expect(await provider.get('algerknown-governance', 'steve')).toBeUndefined();
  });

  it('set() runs secret-tool store and passes the secret via stdin, not argv', async () => {
    let capturedArgs: string[] = [];
    let capturedInput: string | undefined;
    const runner: CommandRunner = async (_command, args, input) => {
      capturedArgs = args;
      capturedInput = input;
      return { code: 0, stdout: '', stderr: '' };
    };
    const provider = createLinuxKeychainProvider(runner);
    await provider.set('algerknown-governance', 'steve', 'my-secret');
    expect(capturedArgs).toEqual([
      'store',
      '--label',
      'algerknown-governance:steve',
      'service',
      'algerknown-governance',
      'account',
      'steve',
    ]);
    expect(capturedArgs.join(' ')).not.toContain('my-secret');
    expect(capturedInput).toBe('my-secret');
  });

  it('set() throws KeychainOperationError on failure', async () => {
    const runner: CommandRunner = async () => ({ code: 1, stdout: '', stderr: 'boom' });
    const provider = createLinuxKeychainProvider(runner);
    await expect(provider.set('svc', 'acct', 'secret')).rejects.toBeInstanceOf(KeychainOperationError);
  });

  it('delete() runs secret-tool clear', async () => {
    let capturedArgs: string[] = [];
    const runner: CommandRunner = async (_command, args) => {
      capturedArgs = args;
      return { code: 0, stdout: '', stderr: '' };
    };
    const provider = createLinuxKeychainProvider(runner);
    await provider.delete('algerknown-governance', 'steve');
    expect(capturedArgs).toEqual(['clear', 'service', 'algerknown-governance', 'account', 'steve']);
  });

  it('delete() throws KeychainOperationError on failure', async () => {
    const runner: CommandRunner = async () => ({ code: 1, stdout: '', stderr: 'No such secret' });
    const provider = createLinuxKeychainProvider(runner);
    await expect(provider.delete('svc', 'acct')).rejects.toBeInstanceOf(KeychainOperationError);
  });
});
