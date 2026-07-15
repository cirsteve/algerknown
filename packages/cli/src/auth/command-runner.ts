import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs an external command, optionally piping `input` to its stdin. Injectable so keychain providers are testable without a real keychain. */
export type CommandRunner = (command: string, args: string[], input?: string) => Promise<CommandResult>;

export const execCommandRunner: CommandRunner = (command, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    // A keychain child (e.g. `secret-tool` with a locked keyring) can exit
    // before draining stdin, which raises EPIPE on this stream. Without a
    // handler that becomes an uncaught exception that crashes the whole CLI.
    // Swallow only EPIPE (the real failure surfaces via the child's exit code
    // and captured stderr in the 'close' handler above); record any other
    // stdin error into stderr so an unexpected failure is still visible in the
    // resolved CommandResult instead of vanishing.
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') {
        stderr += `stdin error: ${err.message}\n`;
      }
    });
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
