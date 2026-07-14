import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');

export interface FixtureDossierEntry {
  summaryId: string;
  projectKey: string;
  path: string;
  snapshotFile: string;
  blobSha: string;
}

export interface FixtureManifest {
  sourceRepository: string;
  sourceCommit: string;
  dossiers: FixtureDossierEntry[];
}

export function loadFixtureManifest(): FixtureManifest {
  const manifestPath = path.join(here, 'fixture.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as FixtureManifest;
}

export function readSnapshot(entry: FixtureDossierEntry): string {
  return fs.readFileSync(path.join(here, entry.snapshotFile), 'utf-8');
}

/** Git's blob object hash: sha1("blob " + byteLength + "\0" + content). */
export function gitBlobHash(content: string): string {
  const bytes = Buffer.from(content, 'utf-8');
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf-8');
  return createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex');
}

/** Extracted for testability; \r?\n so a CRLF checkout doesn't spuriously fail to find an approved SHA that is actually present. */
export function extractApprovedShaFromHandoffContent(content: string): string | undefined {
  return content.match(/```\s*\r?\n([0-9a-f]{40})\s*\r?\n```/)?.[1];
}

/**
 * The cohort-1 compatibility commit is only usable as a fixture if it carries
 * explicit human approval. DOSSIER_COMPAT_FIXTURE.md is that approval record:
 * it was committed through the gated-review process, so its presence and its
 * recorded SHA matching this fixture's sourceCommit *is* the approval check.
 */
export function readApprovedFixtureShaFromHandoff(): string {
  const handoffPath = path.join(repoRoot, 'DOSSIER_COMPAT_FIXTURE.md');
  if (!fs.existsSync(handoffPath)) {
    throw new Error(`No approval handoff found at ${handoffPath}; refusing to trust an unapproved fixture commit.`);
  }
  const content = fs.readFileSync(handoffPath, 'utf-8');
  const sha = extractApprovedShaFromHandoffContent(content);
  if (!sha) {
    throw new Error(`Could not find an approved 40-character commit SHA in ${handoffPath}`);
  }
  return sha;
}

export interface SeededFixtureRepo {
  root: string;
  headCommit: string;
}

/**
 * Materializes a fresh Algerknown knowledge base + git repository seeded with
 * the two vendored fixture snapshots, committed as the repo's initial state.
 * This is the "existing dossier-capable Summary" state the adapter is
 * configured against in conformance tests -- not the cohort-1 source repo
 * itself (which stays external and offline), but a reproducible local stand-in
 * carrying byte-identical content.
 */
export function seedFixtureRepo(targetDir: string): SeededFixtureRepo {
  const manifest = loadFixtureManifest();
  fs.mkdirSync(targetDir, { recursive: true });

  execFileSync('git', ['init', '--initial-branch=main', targetDir], { stdio: 'ignore' });
  execFileSync('git', ['-C', targetDir, 'config', 'user.email', 'fixture@algerknown.dev']);
  execFileSync('git', ['-C', targetDir, 'config', 'user.name', 'Algerknown Fixture Seeder']);
  // Override any global commit.gpgsign so seeding works in sandboxes with no configured signing key.
  execFileSync('git', ['-C', targetDir, 'config', 'commit.gpgsign', 'false']);

  const schemasDir = path.join(targetDir, '.algerknown', 'schemas');
  fs.mkdirSync(schemasDir, { recursive: true });
  for (const schemaFile of ['index.schema.json', 'summary.schema.json', 'entry.schema.json']) {
    fs.copyFileSync(path.join(repoRoot, 'packages/core/schemas', schemaFile), path.join(schemasDir, schemaFile));
  }

  const summariesDir = path.join(targetDir, 'summaries');
  fs.mkdirSync(summariesDir, { recursive: true });

  const indexEntries: Record<string, { path: string; type: 'summary' }> = {};
  for (const dossier of manifest.dossiers) {
    const content = readSnapshot(dossier);
    fs.writeFileSync(path.join(targetDir, dossier.path), content, 'utf-8');
    indexEntries[dossier.summaryId] = { path: dossier.path, type: 'summary' };
  }

  const indexYaml = `# yaml-language-server: $schema=./.algerknown/schemas/index.schema.json\nversion: "1.0.0"\nentries:\n${Object.entries(
    indexEntries,
  )
    .map(([id, e]) => `  ${id}:\n    path: ${e.path}\n    type: ${e.type}`)
    .join('\n')}\n`;
  fs.writeFileSync(path.join(targetDir, 'index.yaml'), indexYaml, 'utf-8');

  execFileSync('git', ['-C', targetDir, 'add', '-A']);
  execFileSync('git', ['-C', targetDir, 'commit', '-m', 'seed: vendored cohort-1 dossier fixture'], { stdio: 'ignore' });
  const headCommit = execFileSync('git', ['-C', targetDir, 'rev-parse', 'HEAD']).toString().trim();

  return { root: targetDir, headCommit };
}
