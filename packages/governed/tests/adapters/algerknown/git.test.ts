import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  GitConcurrentUpdateError,
  commitManagedFiles,
  gitCurrentBranch,
  gitHistoryTouching,
  gitInitIfNeeded,
  gitLastCommitTouching,
  gitRevParse,
  gitShow,
  isWorkingTreeDirty,
  writeFileAtomic,
} from '../../../src/adapters/algerknown/git.js';

describe('git plumbing helper', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'governed-git-test-'));
    gitInitIfNeeded(repoRoot);
    execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@test.dev']);
    execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test']);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('commits the first revision on an unborn branch with parentSha undefined', () => {
    const branch = gitCurrentBranch(repoRoot);
    expect(gitRevParse(repoRoot, branch)).toBeUndefined();

    const commitSha = commitManagedFiles(repoRoot, {
      branch,
      parentSha: undefined,
      files: [{ path: 'summaries/x.yaml', content: 'id: x\n' }],
      subject: 'governed(canonical.project.x): create proposal-1',
      trailers: [{ key: 'Mutation-Hash', value: 'abc123' }],
    });

    expect(commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(gitRevParse(repoRoot, branch)).toBe(commitSha);
    expect(gitShow(repoRoot, commitSha, 'summaries/x.yaml')).toBe('id: x\n');
  });

  it('chains a second commit onto the first with a compare-and-swap ref update', () => {
    const branch = gitCurrentBranch(repoRoot);
    const first = commitManagedFiles(repoRoot, {
      branch,
      parentSha: undefined,
      files: [{ path: 'summaries/x.yaml', content: 'id: x\nv: 1\n' }],
      subject: 'governed(canonical.project.x): create proposal-1',
      trailers: [],
    });

    const second = commitManagedFiles(repoRoot, {
      branch,
      parentSha: first,
      files: [{ path: 'summaries/x.yaml', content: 'id: x\nv: 2\n' }],
      subject: 'governed(canonical.project.x): update proposal-2',
      trailers: [],
    });

    expect(gitRevParse(repoRoot, branch)).toBe(second);
    expect(gitShow(repoRoot, second, 'summaries/x.yaml')).toBe('id: x\nv: 2\n');
    expect(gitShow(repoRoot, first, 'summaries/x.yaml')).toBe('id: x\nv: 1\n');
  });

  it('rejects a commit whose parentSha is stale (concurrent write detection)', () => {
    const branch = gitCurrentBranch(repoRoot);
    const first = commitManagedFiles(repoRoot, {
      branch,
      parentSha: undefined,
      files: [{ path: 'summaries/x.yaml', content: 'v: 1\n' }],
      subject: 'governed(canonical.project.x): create proposal-1',
      trailers: [],
    });
    commitManagedFiles(repoRoot, {
      branch,
      parentSha: first,
      files: [{ path: 'summaries/x.yaml', content: 'v: 2\n' }],
      subject: 'governed(canonical.project.x): update proposal-2',
      trailers: [],
    });

    expect(() =>
      commitManagedFiles(repoRoot, {
        branch,
        parentSha: first, // stale: branch has already moved to the v:2 commit
        files: [{ path: 'summaries/x.yaml', content: 'v: 3-conflicting\n' }],
        subject: 'governed(canonical.project.x): update proposal-3',
        trailers: [],
      }),
    ).toThrow(GitConcurrentUpdateError);
  });

  it('rejects the initial commit if the branch already exists (unborn CAS)', () => {
    const branch = gitCurrentBranch(repoRoot);
    commitManagedFiles(repoRoot, {
      branch,
      parentSha: undefined,
      files: [{ path: 'summaries/x.yaml', content: 'v: 1\n' }],
      subject: 'first',
      trailers: [],
    });

    expect(() =>
      commitManagedFiles(repoRoot, {
        branch,
        parentSha: undefined, // wrong: branch is no longer unborn
        files: [{ path: 'summaries/x.yaml', content: 'v: conflicting\n' }],
        subject: 'second unborn attempt',
        trailers: [],
      }),
    ).toThrow(GitConcurrentUpdateError);
  });

  it('reports history and last-touching commit only for the given path', () => {
    const branch = gitCurrentBranch(repoRoot);
    const first = commitManagedFiles(repoRoot, {
      branch,
      parentSha: undefined,
      files: [{ path: 'a.yaml', content: '1\n' }],
      subject: 'first',
      trailers: [],
    });
    const second = commitManagedFiles(repoRoot, {
      branch,
      parentSha: first,
      files: [
        { path: 'a.yaml', content: '1\n' },
        { path: 'b.yaml', content: '1\n' },
      ],
      subject: 'second',
      trailers: [],
    });

    expect(gitLastCommitTouching(repoRoot, branch, ['b.yaml'])).toBe(second);
    expect(gitLastCommitTouching(repoRoot, branch, ['a.yaml'])).toBe(first);
    expect(gitHistoryTouching(repoRoot, branch, ['a.yaml'])).toEqual([first]);
  });

  it('detects a dirty managed path only after materialization makes the working tree observable', () => {
    const branch = gitCurrentBranch(repoRoot);
    commitManagedFiles(repoRoot, {
      branch,
      parentSha: undefined,
      files: [{ path: 'a.yaml', content: 'committed\n' }],
      subject: 'first',
      trailers: [],
    });

    // commitManagedFiles only touches the git object DB; materializing the
    // working tree (+ the real index, so `git status` sees it as clean) is a
    // separate step the adapter always performs right after committing.
    writeFileAtomic(path.join(repoRoot, 'a.yaml'), 'committed\n');
    execFileSync('git', ['-C', repoRoot, 'add', 'a.yaml']);

    expect(isWorkingTreeDirty(repoRoot, ['a.yaml'])).toBe(false);

    // Now hand-edit it out from under the adapter.
    fs.writeFileSync(path.join(repoRoot, 'a.yaml'), 'hand-edited\n');

    expect(isWorkingTreeDirty(repoRoot, ['a.yaml'])).toBe(true);
  });

  it('writeFileAtomic replaces existing content without leaving a temp file behind', () => {
    const target = path.join(repoRoot, 'nested', 'file.txt');
    writeFileAtomic(target, 'first\n');
    writeFileAtomic(target, 'second\n');

    expect(fs.readFileSync(target, 'utf-8')).toBe('second\n');
    const siblings = fs.readdirSync(path.dirname(target));
    expect(siblings).toEqual(['file.txt']);
  });
});
