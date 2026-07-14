import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  init,
  writeEntry,
  deleteEntry,
  addLink,
  readEntry,
  GovernedWriteBoundaryError,
  loadGovernedBoundaryManifest,
  classifyWriteTarget,
} from '../src/index.js';
import type { Summary } from '../src/index.js';

const TEST_ROOT = path.join(os.tmpdir(), `algerknown-boundary-test-${Date.now()}`);

function writeManifest(managedPaths: string[], namespaces: Record<string, string> = {}): void {
  const dir = path.join(TEST_ROOT, '.algerknown');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'governed-boundary.json'),
    JSON.stringify({ version: 1, generatedAt: new Date(0).toISOString(), managedPaths, namespaces }, null, 2),
    'utf-8',
  );
}

function makeSummary(id: string): Summary {
  return {
    id,
    type: 'summary',
    topic: 'Test topic',
    status: 'active',
    summary: 'A test summary',
  };
}

describe('governed write boundary', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    init(TEST_ROOT);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('classifies as legacy_ungoverned when no manifest exists', () => {
    const target = path.join(TEST_ROOT, 'summaries', 'foo.yaml');
    const result = classifyWriteTarget(TEST_ROOT, target);
    expect(result.classification).toBe('legacy_ungoverned');
  });

  it('loadGovernedBoundaryManifest returns null when the manifest is absent', () => {
    expect(loadGovernedBoundaryManifest(TEST_ROOT)).toBeNull();
  });

  it('allows writeEntry for a legacy_ungoverned path and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeEntry(makeSummary('legacy-summary'), TEST_ROOT);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('legacy_ungoverned write'));
    warnSpy.mockRestore();
  });

  it('classifies a managed path as governed with its namespace', () => {
    writeManifest(['summaries/governed-summary.yaml'], { 'summaries/governed-summary.yaml': 'canonical.project.demo' });
    const target = path.join(TEST_ROOT, 'summaries', 'governed-summary.yaml');
    const result = classifyWriteTarget(TEST_ROOT, target);
    expect(result.classification).toBe('governed');
    expect(result.namespace).toBe('canonical.project.demo');
  });

  it('rejects writeEntry to a governed target with GovernedWriteBoundaryError, without writing the file', () => {
    writeManifest(['summaries/governed-summary.yaml'], { 'summaries/governed-summary.yaml': 'canonical.project.demo' });
    expect(() => writeEntry(makeSummary('governed-summary'), TEST_ROOT)).toThrow(GovernedWriteBoundaryError);
    expect(fs.existsSync(path.join(TEST_ROOT, 'summaries', 'governed-summary.yaml'))).toBe(false);
  });

  it('rejects deleteEntry for a governed target and leaves the file untouched', () => {
    // Create the file first while ungoverned, then govern it afterward.
    writeEntry(makeSummary('will-be-governed'), TEST_ROOT);
    writeManifest(['summaries/will-be-governed.yaml']);
    expect(() => deleteEntry('will-be-governed', TEST_ROOT)).toThrow(GovernedWriteBoundaryError);
    expect(fs.existsSync(path.join(TEST_ROOT, 'summaries', 'will-be-governed.yaml'))).toBe(true);
  });

  it('rejects addLink (via linker -> writeEntry) when the source entry is governed', () => {
    writeEntry(makeSummary('link-source'), TEST_ROOT);
    writeEntry(makeSummary('link-target'), TEST_ROOT);
    writeManifest(['summaries/link-source.yaml']);
    expect(() => addLink('link-source', 'link-target', 'informs', undefined, TEST_ROOT)).toThrow(GovernedWriteBoundaryError);
  });

  it('leaves safe reads unaffected by a governed manifest', () => {
    writeEntry(makeSummary('readable'), TEST_ROOT);
    writeManifest(['summaries/readable.yaml']);
    expect(readEntry('readable', TEST_ROOT)?.id).toBe('readable');
  });
});
