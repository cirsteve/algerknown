import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

/**
 * Every write site in the codebase must be classified as exactly one of:
 *
 * - governed_adapter: the Algerknown git/YAML adapter, the only code
 *   allowed to materialize managed dossier/summary changes.
 * - governed_sqlite: the durable proposal store, governed SQLite
 *   repository, and this web composition root's own operation-intent
 *   ledger in the same database.
 * - rebuildable_cache_telemetry: vector indexes, changelog/diff caches, and
 *   trace/job stores -- explicitly *not* governed memory namespaces.
 * - legacy_ungoverned: Phase 2 has not migrated every historical Algerknown
 *   artifact; these sites remain permitted only for non-governed targets,
 *   enforced by the boundary check in @algerknown/core.
 *
 * A file with a write-shaped call that isn't listed here fails this test --
 * that's the point: a new write site must be deliberately classified, not
 * silently added.
 */
type Classification = 'governed_adapter' | 'governed_sqlite' | 'rebuildable_cache_telemetry' | 'legacy_ungoverned';

const ALLOWLIST: Record<string, Classification> = {
  // -- Algerknown git/YAML adapter: the sole materializer of governed content.
  'packages/governed/src/adapters/algerknown/git.ts': 'governed_adapter',
  'packages/governed/src/adapters/algerknown/repository.ts': 'governed_adapter',

  // -- Governed SQLite: durable proposal store, repository, and transaction plumbing.
  'packages/governed/src/sqlite/repository.ts': 'governed_sqlite',
  'packages/governed/src/sqlite/proposal-repository.ts': 'governed_sqlite',
  'packages/governed/src/sqlite/operation-sink.ts': 'governed_sqlite',
  'packages/governed/src/sqlite/usage-counter.ts': 'governed_sqlite',
  'packages/governed/src/sqlite/migrate.ts': 'governed_sqlite',
  'packages/governed/src/proposals/service.ts': 'governed_sqlite',
  'packages/governed/src/proposals/unit-of-work.ts': 'governed_sqlite',
  // Web-owned operation-intent ledger, same database, for git-target accept/revert recovery.
  'packages/web/src/server/governance/git-operation-intents.ts': 'governed_sqlite',
  // Runtime boundary manifest: regenerated fresh from namespace bindings on
  // every composition-root startup -- a deterministic, rebuildable artifact,
  // not governed content or a legacy KB entry itself.
  'packages/web/src/server/governance/manifest.ts': 'rebuildable_cache_telemetry',

  // -- Legacy_ungoverned: @algerknown/core's low-level store, boundary-checked
  // before every write, and the KB bootstrap (init/schema scaffolding) that
  // Phase 2 does not bring under namespace governance either.
  'packages/core/src/store.ts': 'legacy_ungoverned',
  'packages/core/src/config.ts': 'legacy_ungoverned',

  // -- rag-backend: vector index and changelog/diff cache are explicitly
  // rebuildable application state, never governed memory namespaces.
  'rag-backend/vectorstore.py': 'rebuildable_cache_telemetry',
  'rag-backend/diff_engine.py': 'rebuildable_cache_telemetry',
};

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

describe('write-site allowlist audit', () => {
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
      `Found write site(s) not in the allowlist -- classify them in write-site-audit.test.ts:\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  it('every allowlist entry still exists', () => {
    for (const file of Object.keys(ALLOWLIST)) {
      expect(fs.existsSync(path.join(repoRoot, file)), `allowlisted file "${file}" no longer exists -- remove its stale entry`).toBe(true);
    }
  });

  it('writer.py retains no filesystem write sites (apply_update was removed)', () => {
    const writerPath = path.join(repoRoot, 'rag-backend/writer.py');
    const hits = scanFile(writerPath, [PY_WRITE_MODE_PATTERN, PY_YAML_DUMP_PATTERN]);
    expect(hits).toEqual([]);
  });
});
