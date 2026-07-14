import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

export interface SeededKnowledgeBase {
  root: string;
  binding: { projectKey: string; summaryId: string; path: string };
}

const DOSSIER_YAML = `id: demo-dossier
type: summary
topic: Demo project
status: active
summary: A demo project summary carrying a governed dossier.
dossier:
  project_key: demo
  last_reviewed: "2026-01-01"
  reviewer:
    id: demo-reviewer
    display_name: Demo Reviewer
  evidence:
    - id: evidence-1
      kind: commit
      locator: demo/repo@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      immutable_ref: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  facts:
    - id: fact-seed-1
      claim: The demo project exists.
      status: shipped
      safe_phrasings:
        - The demo project exists.
      evidence_ids:
        - evidence-1
  resources: []
  prohibitions: []
  known_gaps: []
`;

/**
 * A minimal, self-contained git-backed knowledge base fixture for governance
 * composition tests: one dossier-bearing Summary, seeded and committed, with
 * schemas copied from the real package so @algerknown/core validation
 * behaves exactly as it would against a real content repository.
 */
export function seedKnowledgeBase(): SeededKnowledgeBase {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-composition-'));

  execFileSync('git', ['init', '--initial-branch=main', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'user.email', 'fixture@algerknown.dev']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Governance Fixture Seeder']);
  execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);

  const schemasDir = path.join(root, '.algerknown', 'schemas');
  fs.mkdirSync(schemasDir, { recursive: true });
  for (const schemaFile of ['index.schema.json', 'summary.schema.json', 'entry.schema.json']) {
    fs.copyFileSync(path.join(repoRoot, 'packages/core/schemas', schemaFile), path.join(schemasDir, schemaFile));
  }

  const summariesDir = path.join(root, 'summaries');
  fs.mkdirSync(summariesDir, { recursive: true });
  const dossierRelativePath = 'summaries/demo-dossier.yaml';
  fs.writeFileSync(path.join(root, dossierRelativePath), DOSSIER_YAML, 'utf-8');

  const indexYaml = `# yaml-language-server: $schema=./.algerknown/schemas/index.schema.json\nversion: "1.0.0"\nentries:\n  demo-dossier:\n    path: ${dossierRelativePath}\n    type: summary\n`;
  fs.writeFileSync(path.join(root, 'index.yaml'), indexYaml, 'utf-8');

  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'seed: demo dossier fixture'], { stdio: 'ignore' });

  return {
    root,
    binding: { projectKey: 'demo', summaryId: 'demo-dossier', path: dossierRelativePath },
  };
}

export function writeNamespaceBindings(root: string, bindings: SeededKnowledgeBase['binding'][]): string {
  const bindingsPath = path.join(root, '.algerknown', 'governed-namespaces.json');
  fs.mkdirSync(path.dirname(bindingsPath), { recursive: true });
  fs.writeFileSync(bindingsPath, JSON.stringify({ dossiers: bindings }, null, 2), 'utf-8');
  return bindingsPath;
}

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-db-'));
  return {
    GOVERNANCE_DB_PATH: path.join(dbDir, 'governed.sqlite'),
    GOVERNANCE_PROCESSOR_ID: 'test-processor',
    GOVERNANCE_PROCESSOR_VERSION: 'test',
    ...overrides,
  };
}

export function cleanup(kb: SeededKnowledgeBase, env: NodeJS.ProcessEnv): void {
  fs.rmSync(kb.root, { recursive: true, force: true });
  if (env.GOVERNANCE_DB_PATH) {
    fs.rmSync(path.dirname(env.GOVERNANCE_DB_PATH), { recursive: true, force: true });
  }
}
