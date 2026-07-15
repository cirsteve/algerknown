import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recordSuiteEvidence, trackSuiteFailures } from './evidence-helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/**
 * Every write site in the codebase must be deliberately classified as
 * exactly one of the categories in scripts/governance/write-sites.json:
 *
 * - governed_adapter: the Algerknown git/YAML adapter, the only code
 *   allowed to materialize managed dossier/summary changes.
 * - governed_sqlite: the durable proposal store, governed SQLite
 *   repository, and this web composition root's own operation-intent
 *   ledger in the same database.
 * - rebuildable_cache: vector indexes, changelog/diff caches, and the
 *   runtime boundary manifest -- deterministic, disposable, never a
 *   governed memory namespace.
 * - telemetry: trace/job/metrics stores -- also never governed memory.
 * - legacy_ungoverned: Phase 2 has not migrated every historical Algerknown
 *   artifact; these sites remain permitted only for non-governed targets,
 *   enforced by the boundary check in @algerknown/core.
 *
 * A file with a write-shaped call that isn't listed here fails this test --
 * that's the point: a new write site must be deliberately classified, not
 * silently added. The inventory is a checked-in JSON file (not inlined in
 * this test) so it can be reviewed and referenced independently of the test
 * that enforces it.
 */
type Classification = 'governed_adapter' | 'governed_sqlite' | 'rebuildable_cache' | 'telemetry' | 'legacy_ungoverned';

interface WriteSiteEntry {
  path: string;
  classification: Classification;
  owner: string;
  rationale: string;
}

interface WriteSitesFile {
  classifications: Classification[];
  sites: WriteSiteEntry[];
}

const WRITE_SITES_PATH = path.join(repoRoot, 'scripts/governance/write-sites.json');
const writeSitesFile = JSON.parse(fs.readFileSync(WRITE_SITES_PATH, 'utf-8')) as WriteSitesFile;
const ALLOWLIST: Record<string, WriteSiteEntry> = Object.fromEntries(writeSitesFile.sites.map((s) => [s.path, s]));

interface WriteHit {
  file: string;
  line: number;
  text: string;
}

const TS_WRITE_PATTERN =
  /\bfs\.(writeFileSync|writeFile|unlinkSync|unlink|appendFileSync|renameSync|writeSync|rmSync|openSync|mkdirSync)\s*\(/;
const TS_SQLITE_PATTERN = /\.run\(|db\.exec\(/;

const PY_WRITE_MODE_PATTERN = /open\([^)]*["'][wa]["']/;
const PY_YAML_DUMP_PATTERN = /\.dump\(/;

function listFiles(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'tests' || entry.name === '__pycache__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

function scanFile(absPath: string, patterns: RegExp[]): WriteHit[] {
  const relPath = path.relative(repoRoot, absPath).split(path.sep).join('/');
  const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
  const hits: WriteHit[] = [];
  lines.forEach((line, index) => {
    if (patterns.some((pattern) => pattern.test(line))) {
      hits.push({ file: relPath, line: index + 1, text: line.trim() });
    }
  });
  return hits;
}

function findWriteSites(): Map<string, WriteHit[]> {
  const byFile = new Map<string, WriteHit[]>();

  const tsDirs = [
    path.join(repoRoot, 'packages/core/src'),
    path.join(repoRoot, 'packages/governed/src'),
    path.join(repoRoot, 'packages/web/src/server'),
    path.join(repoRoot, 'packages/cli/src'),
  ];
  for (const dir of tsDirs) {
    for (const file of listFiles(dir, ['.ts'])) {
      const hits = scanFile(file, [TS_WRITE_PATTERN, TS_SQLITE_PATTERN]);
      if (hits.length > 0) byFile.set(hits[0]!.file, hits);
    }
  }

  const pyDir = path.join(repoRoot, 'rag-backend');
  for (const entry of fs.readdirSync(pyDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.py')) continue;
    const file = path.join(pyDir, entry.name);
    const hits = scanFile(file, [PY_WRITE_MODE_PATTERN, PY_YAML_DUMP_PATTERN]);
    if (hits.length > 0) byFile.set(hits[0]!.file, hits);
  }

  return byFile;
}

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

describe('write-site allowlist audit (scripts/governance/write-sites.json)', () => {
  it('classifies every detected write site', () => {
    const writeSites = findWriteSites();
    const unclassified: string[] = [];

    for (const [file, hits] of writeSites) {
      if (!(file in ALLOWLIST)) {
        unclassified.push(`${file} (e.g. line ${hits[0]!.line}: ${hits[0]!.text})`);
      }
    }

    expect(
      unclassified,
      `Found write site(s) not in scripts/governance/write-sites.json -- classify them there:\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  it('every allowlist entry still exists, uses a declared classification, and has an owner and rationale', () => {
    for (const entry of writeSitesFile.sites) {
      expect(fs.existsSync(path.join(repoRoot, entry.path)), `allowlisted file "${entry.path}" no longer exists -- remove its stale entry`).toBe(true);
      expect(writeSitesFile.classifications, `"${entry.path}" uses an undeclared classification "${entry.classification}"`).toContain(entry.classification);
      expect(entry.owner.length, `"${entry.path}" is missing an owner`).toBeGreaterThan(0);
      expect(entry.rationale.length, `"${entry.path}" is missing a rationale`).toBeGreaterThan(0);
    }
  });

  it('no allowlist path entry uses a wildcard/glob -- every site is individually reviewed, never bulk-covered', () => {
    const wildcardEntries = writeSitesFile.sites.filter((s) => /[*?[\]]/.test(s.path));
    expect(wildcardEntries.map((s) => s.path)).toEqual([]);
  });

  it('the governed-boundary path matcher itself uses exact inclusion, never a wildcard/glob/prefix match', () => {
    // A prefix or glob match in the boundary reader would silently widen
    // "legacy_ungoverned" (or "governed") to paths never individually
    // reviewed -- this is the "wildcard bypass" the write-site inventory
    // above guards against for the write-sites.json data; this guards the
    // matching *code* itself.
    const boundaryReaderPath = path.join(repoRoot, 'packages/core/src/governed-boundary.ts');
    const content = fs.readFileSync(boundaryReaderPath, 'utf-8');
    expect(content).toMatch(/managedPaths\.includes\(/);
    expect(content).not.toMatch(/managedPaths[^)]*\.(startsWith|match|test)\(/);
    expect(content).not.toMatch(/new RegExp\(/);
    expect(content).not.toMatch(/minimatch|micromatch|glob/i);
  });

  it('writer.py retains no filesystem write sites (apply_update was removed) and neither /approve nor /preview implement a write', () => {
    const writerPath = path.join(repoRoot, 'rag-backend/writer.py');
    const writerHits = scanFile(writerPath, [PY_WRITE_MODE_PATTERN, PY_YAML_DUMP_PATTERN]);
    expect(writerHits).toEqual([]);

    // Static proof that /approve and /preview are retired stubs, not a live
    // handler that happens to not be reached in whatever tests run: both
    // routes must return 410 and neither may import writer's removed
    // apply_update, before any test exercises them over HTTP.
    const apiPath = path.join(repoRoot, 'rag-backend/api.py');
    const apiContent = fs.readFileSync(apiPath, 'utf-8');
    expect(apiContent).not.toMatch(/^\s*from writer import|^\s*import writer\b/m);
    const approveDecorator = apiContent.match(/@app\.\w+\("\/approve"[^)]*\)/)?.[0] ?? '';
    const previewDecorator = apiContent.match(/@app\.\w+\("\/preview"[^)]*\)/)?.[0] ?? '';
    expect(approveDecorator).toMatch(/410/);
    expect(previewDecorator).toMatch(/410/);
  });

  it('the governance HTTP route module imports no raw writer -- every mutation goes through the composition root', () => {
    const governanceRoutePath = path.join(repoRoot, 'packages/web/src/server/routes/governance.ts');
    const content = fs.readFileSync(governanceRoutePath, 'utf-8');
    expect(content).not.toMatch(/from ['"]node:fs['"]|from ['"]fs['"]/);
    expect(content).not.toMatch(/better-sqlite3/);
    // Every mutation this route performs must be through review-actions.ts
    // (acceptProposal/amendProposal/...) or proposalService, both sourced
    // from the composition root -- never a locally-constructed writer.
    expect(content).toMatch(/from '\.\.\/governance\/(review-actions|compose|index)\.js'/);
  });

  it('records ec8-no-write-bypass evidence (static-audit case) once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'ec8-no-write-bypass',
      caseId: 'static-audit',
      suite: 'packages/web/tests/governance/write-site-audit.test.ts',
      fixture: 'scripts/governance/write-sites.json inventory + wildcard-bypass + legacy-/approve + raw-writer-import checks',
      backend: 'ts+py',
      durationMs: Date.now() - suiteStart,
    });
  });
});
