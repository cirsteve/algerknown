import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The git zero-oid, used with `update-ref` to assert "this ref must not currently exist". */
export const GIT_ZERO_OID = '0000000000000000000000000000000000000000';

function run(repoRoot: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd: repoRoot, input, env: env ?? process.env, encoding: 'utf-8' });
}

export function gitInitIfNeeded(repoRoot: string): void {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    run(repoRoot, ['init', '--initial-branch=main']);
  }
}

export function gitCurrentBranch(repoRoot: string): string {
  return run(repoRoot, ['symbolic-ref', '--short', 'HEAD']).trim();
}

/** Returns undefined on an unborn branch (no commits yet). */
export function gitRevParse(repoRoot: string, ref: string): string | undefined {
  try {
    return run(repoRoot, ['rev-parse', '--verify', ref]).trim();
  } catch {
    return undefined;
  }
}

/** The most recent commit touching any of `paths`, or undefined if none has ever touched them. */
export function gitLastCommitTouching(repoRoot: string, ref: string, paths: string[]): string | undefined {
  if (gitRevParse(repoRoot, ref) === undefined) return undefined;
  const out = run(repoRoot, ['log', '-n', '1', '--format=%H', ref, '--', ...paths]).trim();
  return out.length > 0 ? out : undefined;
}

/** All commits touching any of `paths`, oldest first. */
export function gitHistoryTouching(repoRoot: string, ref: string, paths: string[]): string[] {
  if (gitRevParse(repoRoot, ref) === undefined) return [];
  const out = run(repoRoot, ['log', '--format=%H', '--reverse', ref, '--', ...paths]).trim();
  return out.length > 0 ? out.split('\n') : [];
}

export function gitShow(repoRoot: string, ref: string, filePath: string): string | undefined {
  try {
    return run(repoRoot, ['show', `${ref}:${filePath}`]);
  } catch {
    return undefined;
  }
}

export function gitStatusPorcelain(repoRoot: string, paths: string[]): string {
  return run(repoRoot, ['status', '--porcelain', '--', ...paths]);
}

/**
 * True if any of `paths` differ from HEAD in either the working tree or the
 * index -- i.e. someone has unmanaged, uncommitted changes to a path this
 * adapter is about to write through. `git status` is always HEAD-relative,
 * so this reflects the *current* branch tip, not an arbitrary historical ref.
 */
export function isWorkingTreeDirty(repoRoot: string, paths: string[]): boolean {
  if (gitRevParse(repoRoot, 'HEAD') === undefined) {
    // Unborn branch: "dirty" means the paths already exist on disk unexpectedly.
    return paths.some((p) => fs.existsSync(path.join(repoRoot, p)));
  }
  return gitStatusPorcelain(repoRoot, paths).trim().length > 0;
}

function hashObjectWrite(repoRoot: string, content: string): string {
  return run(repoRoot, ['hash-object', '-w', '--stdin'], content).trim();
}

export interface ManagedFileWrite {
  path: string;
  content: string;
}

export interface CommitTrailer {
  key: string;
  value: string;
}

export interface IsolatedCommitRequest {
  branch: string;
  /** The branch tip this commit must be based on; undefined for the first commit on an unborn branch. */
  parentSha: string | undefined;
  files: ManagedFileWrite[];
  subject: string;
  trailers: CommitTrailer[];
}

export class GitConcurrentUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitConcurrentUpdateError';
  }
}

/**
 * Stages exactly `files` (nothing else -- not the caller's real index, not
 * their working tree) through an isolated temporary index, writes one
 * commit, and updates the branch ref with a compare-and-swap against
 * `parentSha`. Throws GitConcurrentUpdateError if the branch moved since
 * `parentSha` was observed.
 */
export function commitManagedFiles(repoRoot: string, request: IsolatedCommitRequest): string {
  const tmpIndexPath = path.join(repoRoot, '.git', `governed-index.${process.pid}.${process.hrtime.bigint()}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndexPath };

  try {
    if (request.parentSha) {
      run(repoRoot, ['read-tree', request.parentSha], undefined, env);
    }
    for (const file of request.files) {
      const blobSha = hashObjectWrite(repoRoot, file.content);
      run(repoRoot, ['update-index', '--add', '--cacheinfo', `100644,${blobSha},${file.path}`], undefined, env);
    }
    const treeSha = run(repoRoot, ['write-tree'], undefined, env).trim();

    const message = [request.subject, '', ...request.trailers.map((t) => `${t.key}: ${t.value}`)].join('\n');
    const commitArgs = ['commit-tree', treeSha, '-m', message];
    if (request.parentSha) commitArgs.push('-p', request.parentSha);
    const commitSha = run(repoRoot, commitArgs, undefined, env).trim();

    const oldValue = request.parentSha ?? GIT_ZERO_OID;
    try {
      run(repoRoot, ['update-ref', `refs/heads/${request.branch}`, commitSha, oldValue]);
    } catch (err) {
      throw new GitConcurrentUpdateError(
        `refs/heads/${request.branch} moved since revision ${oldValue} was observed; refusing to overwrite a concurrent write: ${(err as Error).message}`,
      );
    }

    return commitSha;
  } finally {
    fs.rmSync(tmpIndexPath, { force: true });
  }
}

/** Atomically writes `content` to `filePath`: write to a sibling temp file, fsync, then rename over the target. */
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${process.hrtime.bigint()}`);
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, content, null, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}
