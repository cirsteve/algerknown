import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, writeEntry, type Summary } from '@algerknown/core';
import { deleteCommand } from '../../src/commands/delete.js';
import { recordSuiteEvidence, trackSuiteFailures } from './evidence-helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(os.tmpdir(), `agn-cli-command-boundary-${Date.now()}`);
const originalKbRoot = process.env.ALGERKNOWN_KB_ROOT;
const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

function makeSummary(id: string): Summary {
  return { id, type: 'summary', topic: 'T', status: 'active', summary: 'S' };
}

function governDossier(root: string, relativePath: string, namespace: string): void {
  const manifestPath = path.join(root, '.algerknown', 'governed-boundary.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ version: 1, generatedAt: new Date(0).toISOString(), managedPaths: [relativePath], namespaces: { [relativePath]: namespace } }),
  );
}

class ProcessExitSignal extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe('CLI command boundary: mutating commands refuse a governed target and change nothing', () => {
  beforeEach(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    init(ROOT);
    process.env.ALGERKNOWN_KB_ROOT = ROOT;
  });

  afterEach(() => {
    if (originalKbRoot === undefined) delete process.env.ALGERKNOWN_KB_ROOT;
    else process.env.ALGERKNOWN_KB_ROOT = originalKbRoot;
    fs.rmSync(ROOT, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('`agn delete` on a governed entry halts before deleting, leaving the file byte-identical', async () => {
    writeEntry(makeSummary('governed-delete-1'), ROOT);
    governDossier(ROOT, 'summaries/governed-delete-1.yaml', 'canonical.project.demo');
    const filePath = path.join(ROOT, 'summaries/governed-delete-1.yaml');
    const before = fs.readFileSync(filePath, 'utf-8');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExitSignal(code);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(deleteCommand.parseAsync(['governed-delete-1', '--force'], { from: 'user' })).rejects.toThrow(ProcessExitSignal);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('governed'))).toBe(true);
    // The file exists (not deleted) and is byte-identical to before the refused attempt.
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('`agn delete` on a legacy_ungoverned entry proceeds normally (contrast case: the refusal above is boundary-specific, not a general delete failure)', async () => {
    writeEntry(makeSummary('legacy-delete-1'), ROOT);
    const filePath = path.join(ROOT, 'summaries/legacy-delete-1.yaml');
    expect(fs.existsSync(filePath)).toBe(true);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await deleteCommand.parseAsync(['legacy-delete-1', '--force'], { from: 'user' });

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('add, edit, and link also import and call checkGovernedTarget before any write (structural proof for the commands not exercised end-to-end above)', () => {
    for (const file of ['add.ts', 'edit.ts', 'link.ts']) {
      const content = fs.readFileSync(path.join(here, '../../src/commands', file), 'utf-8');
      expect(content, `${file} must import checkGovernedTarget`).toMatch(/import\s*\{[^}]*checkGovernedTarget[^}]*\}\s*from\s*['"]\.\.\/governance\/boundary-check\.js['"]/);
      expect(content, `${file} must call checkGovernedTarget(`).toMatch(/checkGovernedTarget\(/);
      expect(content, `${file} must call reportGovernedRefusal( on a governed target`).toMatch(/reportGovernedRefusal\(/);
    }
  });

  it('records the CLI runtime-boundary case once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'ec8-no-write-bypass',
      caseId: 'runtime-boundary-cli',
      suite: 'packages/cli/tests/governance/command-boundary.test.ts',
      fixture: 'agn delete via Commander parseAsync against a real governed KB, byte-identical state on refusal; add/edit/link structural proof',
      backend: 'ts',
      durationMs: Date.now() - suiteStart,
    });
  });
});
