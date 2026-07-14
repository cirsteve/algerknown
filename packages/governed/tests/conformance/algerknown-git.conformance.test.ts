import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse } from 'yaml';
import type { Dossier, Summary } from '@algerknown/core';
import { GitAlgerknownRepository, encodeNamespaceForPath, namespaceForBinding, subjectForBinding, type DossierBinding } from '../../src/adapters/algerknown/index.js';
import { seedFixtureRepo } from '../fixtures/algerknown/loader.js';
import { createTestClock } from '../fixtures/clock.js';
import { createTestIdGenerator } from '../fixtures/id-generator.js';
import { StubAttestationVerifier } from '../fixtures/attestation-verifier.js';
import { runRepositoryConformanceSuite } from './repository-conformance.js';

const binding: DossierBinding = {
  projectKey: 'agent-evals',
  summaryId: 'agent-evals-dossier',
  path: 'summaries/agent-evals-dossier.yaml',
};

interface GitContext {
  repoRoot: string;
}

function readDossier(repoRoot: string): Dossier {
  const content = fs.readFileSync(path.join(repoRoot, binding.path), 'utf-8');
  return (parse(content) as Summary).dossier!;
}

/**
 * Proves the same reusable repository semantics through the actual
 * algerknown git adapter, seeded from the pinned cohort-1 compatibility
 * fixture -- not a hand-rolled stand-in dossier.
 */
runRepositoryConformanceSuite<GitContext>({
  seedFixture: async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'governed-algerknown-conformance-'));
    seedFixtureRepo(repoRoot);
    const dossier = readDossier(repoRoot);
    return {
      context: { repoRoot },
      fixture: {
        namespace: namespaceForBinding(binding),
        subject: subjectForBinding(binding),
        evidenceId: dossier.evidence[0]!.id,
        alternateEvidenceId: dossier.evidence[1]!.id,
        factId: dossier.facts[0]!.id,
      },
    };
  },
  createRepository: (context) => new GitAlgerknownRepository({ repoRoot: context.repoRoot, binding }),
  teardown: (context) => {
    fs.rmSync(context.repoRoot, { recursive: true, force: true });
  },
  createClock: () => createTestClock(),
  createIdGenerator: () => createTestIdGenerator('conf'),
  createAttestationVerifier: () => new StubAttestationVerifier(),
  simulateCrashMidWrite: (context) => {
    // Simulate a crash *after* a commit has landed but *before* materialization
    // completed: corrupt the working tree, then leave a recovery marker whose
    // recorded parentSha no longer matches the branch tip, so recovery takes
    // the "a commit landed -- rematerialize from it" path.
    const namespace = namespaceForBinding(binding);
    fs.writeFileSync(path.join(context.repoRoot, binding.path), 'SIMULATED-CRASH-CORRUPTION\n');
    const markerPath = path.join(context.repoRoot, '.algerknown/governed/.recovery', `${encodeNamespaceForPath(namespace)}.json`);
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ parentSha: null, paths: [binding.path], previousContent: ['SIMULATED-CRASH-CORRUPTION\n'] }),
    );
  },
});
