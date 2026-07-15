import { describe, expect, it } from 'vitest';
import { execCommandRunner } from '../../src/auth/command-runner.js';

// The keychain child (e.g. `secret-tool` against a locked keyring) can exit
// before draining stdin. Writing to that closed pipe raises EPIPE on the
// stdin stream; without the stream error handler that becomes an uncaught
// exception that crashes the whole CLI. These tests exercise the real spawn
// path rather than the mocked CommandRunner the provider tests use.
describe('execCommandRunner', () => {
  it('delivers stdin to the child and captures stdout/exit code', async () => {
    const script = "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(d.toUpperCase());process.exit(0);});";
    const result = await execCommandRunner(process.execPath, ['-e', script], 'hello');
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('HELLO');
  });

  it('does not crash on EPIPE when the child exits before reading a large stdin', async () => {
    // Child exits immediately without reading stdin. A payload larger than the
    // OS pipe buffer (~64KB) guarantees the write outlives the reader and
    // raises EPIPE, which must be swallowed so the child's real exit code
    // surfaces instead of an uncaught exception.
    const largeInput = 'x'.repeat(512 * 1024);
    const result = await execCommandRunner(process.execPath, ['-e', 'process.exit(7)'], largeInput);
    expect(result.code).toBe(7);
  });
});
