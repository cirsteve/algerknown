import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asActorId, asEdgeId, asIdempotencyKey, asNodeId, asProcessorId, type WriteCommand } from '@algerknown/governed';
import { namespaceForBinding, subjectForBinding, type DossierBinding } from '@algerknown/governed/adapters/algerknown';
import { createGovernanceComposition, type GovernanceComposition } from '../../../web/src/server/governance/index.js';
import { loadGovernanceConfig } from '../../../web/src/server/auth/governance-config.js';
import { createSessionRegistry } from '../../../web/src/server/auth/session-registry.js';
import { createUnlockRateLimiter } from '../../../web/src/server/auth/unlock-rate-limiter.js';
import type { GovernanceRuntime } from '../../../web/src/server/auth/governance-runtime.js';
import { createGovernanceRouter } from '../../../web/src/server/routes/governance.js';
import { reviewCommand } from '../../src/commands/review.js';
import { recordSuiteEvidence, trackSuiteFailures } from './evidence-helpers.js';

const REVIEWER_SECRET = 'r'.repeat(32);
const PROCESSOR_SECRET = 'p'.repeat(32);
const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

interface SeededKb {
  root: string;
  binding: DossierBinding;
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

function seedKb(): SeededKb {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-review-command-'));
  execFileSync('git', ['init', '--initial-branch=main', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'user.email', 'fixture@algerknown.dev']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Fixture Seeder']);
  execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);
  const schemasDir = path.join(root, '.algerknown', 'schemas');
  fs.mkdirSync(schemasDir, { recursive: true });
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
  for (const schemaFile of ['index.schema.json', 'summary.schema.json', 'entry.schema.json']) {
    fs.copyFileSync(path.join(repoRoot, 'packages/core/schemas', schemaFile), path.join(schemasDir, schemaFile));
  }
  fs.mkdirSync(path.join(root, 'summaries'), { recursive: true });
  const dossierRelativePath = 'summaries/demo-dossier.yaml';
  fs.writeFileSync(path.join(root, dossierRelativePath), DOSSIER_YAML, 'utf-8');
  fs.writeFileSync(
    path.join(root, 'index.yaml'),
    `# yaml-language-server: $schema=./.algerknown/schemas/index.schema.json\nversion: "1.0.0"\nentries:\n  demo-dossier:\n    path: ${dossierRelativePath}\n    type: summary\n`,
    'utf-8',
  );
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'seed: demo dossier fixture'], { stdio: 'ignore' });
  return { root, binding: { projectKey: 'demo', summaryId: 'demo-dossier', path: dossierRelativePath } };
}

function gitCommitCount(repoRoot: string): number {
  return Number(execFileSync('git', ['-C', repoRoot, 'rev-list', '--count', 'HEAD'], { encoding: 'utf-8' }).trim());
}

describe('CLI `agn review` end to end against a real governed HTTP server', () => {
  let kb: SeededKb | undefined;
  let dbDir: string | undefined;
  let composition: GovernanceComposition | undefined;
  let server: import('node:http').Server | undefined;
  const originalEnv = { ...process.env };

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    composition?.close();
    if (kb) fs.rmSync(kb.root, { recursive: true, force: true });
    if (dbDir) fs.rmSync(dbDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function bootServer(): Promise<{ origin: string }> {
    kb = seedKb();
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-review-command-db-'));
    fs.writeFileSync(
      path.join(kb.root, '.algerknown', 'governed-namespaces.json'),
      JSON.stringify({ dossiers: [kb.binding] }, null, 2),
    );
    composition = await createGovernanceComposition({
      env: {
        ALGERKNOWN_ROOT: kb.root,
        GOVERNANCE_DB_PATH: path.join(dbDir, 'governed.sqlite'),
        GOVERNANCE_PROCESSOR_ID: 'test-processor',
        GOVERNANCE_PROCESSOR_VERSION: 'test',
      },
    });

    const app = express();
    app.use(express.json());
    server = app.listen(0);
    await new Promise((resolve) => server!.once('listening', resolve));
    const { port } = server.address() as import('node:net').AddressInfo;
    const origin = `http://127.0.0.1:${port}`;

    const config = loadGovernanceConfig({
      GOVERNANCE_REVIEWER_ID: 'steve',
      GOVERNANCE_REVIEWER_DISPLAY_NAME: 'Steve',
      GOVERNANCE_REVIEWER_SECRET: REVIEWER_SECRET,
      GOVERNANCE_PROCESSOR_ID: 'test-processor',
      GOVERNANCE_PROCESSOR_SECRET: PROCESSOR_SECRET,
      GOVERNANCE_PUBLIC_ORIGIN: origin,
    });
    const clock = { now: () => new Date().toISOString() };
    const runtime: GovernanceRuntime = { config, clock, sessionRegistry: createSessionRegistry({ clock }), unlockRateLimiter: createUnlockRateLimiter({ clock }) };
    app.use('/api/governance', createGovernanceRouter(runtime, composition));

    process.env.GOVERNANCE_API_URL = `${origin}/api/governance`;
    process.env.ALGERKNOWN_REVIEWER_SECRET = REVIEWER_SECRET;

    return { origin };
  }

  function factCommand(nodeId: string, edgeId: string): WriteCommand {
    return {
      namespace: namespaceForBinding(kb!.binding),
      subject: subjectForBinding(kb!.binding),
      nodeMutations: [
        { op: 'create', nodeId: asNodeId(nodeId), nodeType: 'fact', payload: { statement: `Statement for ${nodeId}.`, attributes: { status: 'shipped', safe_phrasings: [`Statement for ${nodeId}.`] } }, confidence: 0.9 },
      ],
      edgeMutations: [{ op: 'create', edgeId: asEdgeId(edgeId), kind: 'evidence_for', sourceId: asNodeId('evidence-1'), targetId: asNodeId(nodeId) }],
      expectedNamespaceRevision: null,
      idempotencyKey: asIdempotencyKey(`cmd-${nodeId}`),
      actorId: asActorId('test-processor'),
      actorClass: 'processor',
      provenanceInput: { sources: [{ kind: 'external', id: 'evidence-1' }], processorId: asProcessorId('test-processor') },
    };
  }

  it('`agn review accept` applies a pending proposal over the real HTTP API, attributed to channel "cli"', async () => {
    await bootServer();
    const proposed = await composition!.proposalService.propose({ mutation: factCommand('fact-cli-accept-1', 'edge-cli-accept-1'), supportingObservationIds: [], idempotencyKey: 'propose-cli-accept-1' });
    if (proposed.outcome !== 'created') throw new Error('expected created');
    const commitsBefore = gitCommitCount(kb!.root);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await reviewCommand.parseAsync(['accept', proposed.proposal.id, '--yes'], { from: 'user' });

    expect(gitCommitCount(kb!.root)).toBe(commitsBefore + 1);
    const inspection = await composition!.proposalService.inspect(proposed.proposal.id);
    expect(inspection.proposal.status).toBe('accepted');
    const acceptedEvent = inspection.events.find((e) => e.kind === 'accepted')!;
    expect(acceptedEvent.channel).toBe('cli');
    expect(String(acceptedEvent.actorId)).toBe('steve');
  });

  it('`agn review reject` rejects a pending proposal with a reason over the real HTTP API', async () => {
    await bootServer();
    const proposed = await composition!.proposalService.propose({ mutation: factCommand('fact-cli-reject-1', 'edge-cli-reject-1'), supportingObservationIds: [], idempotencyKey: 'propose-cli-reject-1' });
    if (proposed.outcome !== 'created') throw new Error('expected created');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await reviewCommand.parseAsync(['reject', proposed.proposal.id, '--reason', 'Not credible enough.', '--yes'], { from: 'user' });

    const inspection = await composition!.proposalService.inspect(proposed.proposal.id);
    expect(inspection.proposal.status).toBe('rejected');
    expect(inspection.events.find((e) => e.kind === 'rejected')?.reason).toBe('Not credible enough.');
  });

  it('`agn review amend` then `agn review accept` applies the amended content, and `agn review revert` restores the dossier', async () => {
    await bootServer();
    const proposed = await composition!.proposalService.propose({ mutation: factCommand('fact-cli-amend-1', 'edge-cli-amend-1'), supportingObservationIds: [], idempotencyKey: 'propose-cli-amend-1' });
    if (proposed.outcome !== 'created') throw new Error('expected created');

    const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-review-patch-'));
    const patchPath = path.join(patchDir, 'patch.json');
    fs.writeFileSync(
      patchPath,
      JSON.stringify([{ op: 'replace', path: '/nodeMutations/0/payload/attributes/safe_phrasings', value: ['Amended via CLI.'] }]),
    );

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await reviewCommand.parseAsync(['amend', proposed.proposal.id, '--note', 'CLI amendment.', '--patch-file', patchPath], { from: 'user' });

    const afterAmend = await composition!.proposalService.getProposal(proposed.proposal.id);
    expect(afterAmend?.version).toBe(2);

    await reviewCommand.parseAsync(['accept', proposed.proposal.id, '--yes'], { from: 'user' });
    const namespace = namespaceForBinding(kb!.binding);
    const nodeAfterAccept = await composition!.repository.getNode(namespace, asNodeId('fact-cli-amend-1'));
    expect((nodeAfterAccept!.payload as { attributes: { safe_phrasings: string[] } }).attributes.safe_phrasings).toEqual(['Amended via CLI.']);

    await reviewCommand.parseAsync(['revert', proposed.proposal.id, '--reason', 'CLI-only test change.', '--yes'], { from: 'user' });
    const nodeAfterRevert = await composition!.repository.getNode(namespace, asNodeId('fact-cli-amend-1'));
    expect(nodeAfterRevert).toBeUndefined();

    fs.rmSync(patchDir, { recursive: true, force: true });
  });

  it('records ec7-authenticated-boundary evidence (cli case) once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'ec7-authenticated-boundary',
      caseId: 'cli',
      suite: 'packages/cli/tests/governance/review-command.test.ts',
      fixture: 'agn review accept/reject/amend/revert via Commander parseAsync against a real governed HTTP server, ALGERKNOWN_REVIEWER_SECRET-authenticated',
      backend: 'algerknown',
      durationMs: Date.now() - suiteStart,
    });
  });
});
