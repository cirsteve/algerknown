import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import type { Dossier, Summary } from '@algerknown/core';
import {
  asActorId,
  asIdempotencyKey,
  asNodeId,
  asRevisionId,
  type GovernedNode,
  type PreparedWrite,
} from '../../../src/index.js';
import {
  GitAlgerknownRepository,
  buildEdgeId,
  namespaceForBinding,
  subjectForBinding,
  sidecarRelativePath,
  encodeNamespaceForPath,
  type DossierBinding,
} from '../../../src/adapters/algerknown/index.js';
import { gitRevParse, gitShow, writeFileAtomic } from '../../../src/adapters/algerknown/git.js';
import { seedFixtureRepo } from '../../fixtures/algerknown/loader.js';

const binding: DossierBinding = {
  projectKey: 'agent-evals',
  summaryId: 'agent-evals-dossier',
  path: 'summaries/agent-evals-dossier.yaml',
};

function readDossierFile(repoRoot: string): Dossier {
  const content = fs.readFileSync(path.join(repoRoot, binding.path), 'utf-8');
  return (parse(content) as Summary).dossier!;
}

function buildCreateFactWrite(
  namespace: ReturnType<typeof namespaceForBinding>,
  subject: ReturnType<typeof subjectForBinding>,
  opts: { previousRevision: number | null; idempotencyKey: string; evidenceId: string; secondEvidenceId?: string; confidence?: number },
): PreparedWrite {
  const nodeId = asNodeId('fact-new-from-test');
  const revisionId = asRevisionId(`rev-${opts.idempotencyKey}`);
  const provenance = { sources: [{ kind: 'external' as const, id: opts.evidenceId }], railId: 'human-gated', evaluatorVerdicts: [] };
  const revision = {
    revisionId,
    namespaceRevision: (opts.previousRevision ?? 0) + 1,
    createdAt: '2026-07-14T00:00:00.000Z',
    actorId: asActorId('test-actor'),
    actorClass: 'human' as const,
  };

  const factNode: GovernedNode = {
    id: nodeId,
    type: 'fact',
    namespace,
    subject,
    payload: { statement: 'A new fact created by the repository test.', attributes: { status: 'shipped', safe_phrasings: ['A new fact.'] } },
    confidence: opts.confidence ?? 1,
    provenance,
    revision,
  } as unknown as GovernedNode;

  const edge = {
    id: buildEdgeId('evidence_for', asNodeId(opts.evidenceId), nodeId),
    kind: 'evidence_for' as const,
    namespace,
    sourceId: asNodeId(opts.evidenceId),
    targetId: nodeId,
    provenance,
    revision,
  };

  const edgesUpserted = [edge];
  const edgeDiffs = [{ entityKind: 'edge' as const, entityId: edge.id, changeKind: 'create' as const, forward: [{ path: '$', before: null, after: edge }], inverse: [{ path: '$', before: edge, after: null }] }];

  if (opts.secondEvidenceId) {
    const secondEdge = {
      id: buildEdgeId('evidence_for', asNodeId(opts.secondEvidenceId), nodeId),
      kind: 'evidence_for' as const,
      namespace,
      sourceId: asNodeId(opts.secondEvidenceId),
      targetId: nodeId,
      provenance,
      revision,
    };
    edgesUpserted.push(secondEdge);
    edgeDiffs.push({ entityKind: 'edge' as const, entityId: secondEdge.id, changeKind: 'create' as const, forward: [{ path: '$', before: null, after: secondEdge }], inverse: [{ path: '$', before: secondEdge, after: null }] });
  }

  return {
    namespace,
    previousRevision: opts.previousRevision,
    resultingRevision: revision.namespaceRevision,
    revisionRecord: {
      namespace,
      revisionId,
      previousRevision: opts.previousRevision,
      namespaceRevision: revision.namespaceRevision,
      createdAt: revision.createdAt,
      actorId: revision.actorId,
      actorClass: revision.actorClass,
      diff: [
        { entityKind: 'node', entityId: nodeId, changeKind: 'create', forward: [{ path: '$', before: null, after: factNode }], inverse: [{ path: '$', before: factNode, after: null }] },
        ...edgeDiffs,
      ],
      idempotencyKey: asIdempotencyKey(opts.idempotencyKey),
    },
    nodesUpserted: [factNode],
    nodesDeleted: [],
    edgesUpserted,
    edgesDeleted: [],
  };
}

/** Updates only the fact node's confidence, leaving everything else untouched. */
function buildConfidenceUpdateWrite(
  namespace: ReturnType<typeof namespaceForBinding>,
  subject: ReturnType<typeof subjectForBinding>,
  opts: { previousRevision: number; idempotencyKey: string; newConfidence: number; priorNode: GovernedNode },
): PreparedWrite {
  const revisionId = asRevisionId(`rev-${opts.idempotencyKey}`);
  const revision = {
    revisionId,
    namespaceRevision: opts.previousRevision + 1,
    createdAt: '2026-07-14T00:05:00.000Z',
    actorId: asActorId('test-actor'),
    actorClass: 'human' as const,
  };
  const updatedNode: GovernedNode = { ...opts.priorNode, confidence: opts.newConfidence, revision } as unknown as GovernedNode;

  return {
    namespace,
    previousRevision: opts.previousRevision,
    resultingRevision: revision.namespaceRevision,
    revisionRecord: {
      namespace,
      revisionId,
      previousRevision: opts.previousRevision,
      namespaceRevision: revision.namespaceRevision,
      createdAt: revision.createdAt,
      actorId: revision.actorId,
      actorClass: revision.actorClass,
      diff: [
        {
          entityKind: 'node',
          entityId: opts.priorNode.id,
          changeKind: 'update',
          forward: [{ path: 'confidence', before: opts.priorNode.confidence, after: opts.newConfidence }],
          inverse: [{ path: 'confidence', before: opts.newConfidence, after: opts.priorNode.confidence }],
        },
      ],
      idempotencyKey: asIdempotencyKey(opts.idempotencyKey),
    },
    nodesUpserted: [updatedNode],
    nodesDeleted: [],
    edgesUpserted: [],
    edgesDeleted: [],
  };
}

/** Changes a previously-created evidence_for edge's kind to a sidecar-only kind, endpoints unchanged. */
function buildEdgeKindChangeWrite(
  namespace: ReturnType<typeof namespaceForBinding>,
  subject: ReturnType<typeof subjectForBinding>,
  opts: { previousRevision: number; idempotencyKey: string; priorEdge: { id: ReturnType<typeof buildEdgeId>; sourceId: ReturnType<typeof asNodeId>; targetId: ReturnType<typeof asNodeId> } },
): PreparedWrite {
  const revisionId = asRevisionId(`rev-${opts.idempotencyKey}`);
  const revision = {
    revisionId,
    namespaceRevision: opts.previousRevision + 1,
    createdAt: '2026-07-14T00:10:00.000Z',
    actorId: asActorId('test-actor'),
    actorClass: 'human' as const,
  };
  const provenance = { sources: [], railId: 'human-gated', evaluatorVerdicts: [] };
  const updatedEdge = {
    id: opts.priorEdge.id,
    kind: 'derived_from' as const,
    namespace,
    sourceId: opts.priorEdge.sourceId,
    targetId: opts.priorEdge.targetId,
    provenance,
    revision,
  };

  return {
    namespace,
    previousRevision: opts.previousRevision,
    resultingRevision: revision.namespaceRevision,
    revisionRecord: {
      namespace,
      revisionId,
      previousRevision: opts.previousRevision,
      namespaceRevision: revision.namespaceRevision,
      createdAt: revision.createdAt,
      actorId: revision.actorId,
      actorClass: revision.actorClass,
      diff: [
        {
          entityKind: 'edge',
          entityId: opts.priorEdge.id,
          changeKind: 'update',
          forward: [{ path: 'kind', before: 'evidence_for', after: 'derived_from' }],
          inverse: [{ path: 'kind', before: 'derived_from', after: 'evidence_for' }],
        },
      ],
      idempotencyKey: asIdempotencyKey(opts.idempotencyKey),
    },
    nodesUpserted: [],
    nodesDeleted: [],
    edgesUpserted: [updatedEdge],
    edgesDeleted: [],
  };
}

describe('GitAlgerknownRepository', () => {
  let repoRoot: string;
  let namespace: ReturnType<typeof namespaceForBinding>;
  let subject: ReturnType<typeof subjectForBinding>;
  let repository: GitAlgerknownRepository;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'governed-algerknown-repo-test-'));
    seedFixtureRepo(repoRoot);
    namespace = namespaceForBinding(binding);
    subject = subjectForBinding(binding);
    repository = new GitAlgerknownRepository({ repoRoot, binding });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  describe('reads against a repository with no governed history yet', () => {
    it('getNamespaceRevision is null', async () => {
      expect(await repository.getNamespaceRevision(namespace)).toBeNull();
    });

    it('getNode synthesizes provenance from the seed commit for an existing fact', async () => {
      const dossier = readDossierFile(repoRoot);
      const fact = dossier.facts[0]!;
      const node = await repository.getNode(namespace, asNodeId(fact.id));

      expect(node).toBeDefined();
      expect(node!.type).toBe('fact');
      expect(node!.namespace).toBe(namespace);
      expect(node!.subject).toBe(subject);
      expect(node!.revision.namespaceRevision).toBe(0);
      expect(String(node!.revision.revisionId)).toMatch(/^git:[0-9a-f]{40}$/);
    });

    it('getEdge finds a native evidence_for edge derived from the dossier', async () => {
      const dossier = readDossierFile(repoRoot);
      const fact = dossier.facts[0]!;
      const evidenceId = fact.evidence_ids[0];
      const edgeId = buildEdgeId('evidence_for', asNodeId(evidenceId), asNodeId(fact.id));

      const edge = await repository.getEdge(namespace, edgeId);
      expect(edge).toBeDefined();
      expect(edge!.kind).toBe('evidence_for');
    });

    it('getNode returns undefined for an unknown id', async () => {
      expect(await repository.getNode(namespace, asNodeId('does-not-exist'))).toBeUndefined();
    });
  });

  describe('commit', () => {
    it('reclaims an orphaned lock left by a crashed writer instead of wedging every future write', async () => {
      const dossier = readDossierFile(repoRoot);
      const evidenceId = dossier.evidence[0]!.id;
      const write = buildCreateFactWrite(namespace, subject, { previousRevision: null, idempotencyKey: 'idem-lock', evidenceId });

      // Simulate a crash between lock-acquire and release: a lock file naming a
      // pid that is no longer running. Without reclamation this would time out
      // and then fail on every subsequent write.
      const lockPath = path.join(repoRoot, '.algerknown/governed/.locks', `${encodeNamespaceForPath(namespace)}.lock`);
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, '999999999');

      await repository.commit(write);

      expect(await repository.getNode(namespace, asNodeId('fact-new-from-test'))).toBeDefined();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('creates a git commit, advances the namespace revision, and persists through the sidecar', async () => {
      const dossier = readDossierFile(repoRoot);
      const evidenceId = dossier.evidence[0]!.id;
      const write = buildCreateFactWrite(namespace, subject, { previousRevision: null, idempotencyKey: 'idem-1', evidenceId });

      const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current']).toString().trim();
      const before = gitRevParse(repoRoot, branch);

      await repository.commit(write);

      const after = gitRevParse(repoRoot, branch);
      expect(after).not.toBe(before);
      expect(await repository.getNamespaceRevision(namespace)).toBe(1);

      const node = await repository.getNode(namespace, asNodeId('fact-new-from-test'));
      expect(node).toBeDefined();
      expect((node!.payload as unknown as { statement: string }).statement).toBe('A new fact created by the repository test.');

      const dossierAfter = readDossierFile(repoRoot);
      const newFact = dossierAfter.facts.find((f) => f.id === 'fact-new-from-test');
      expect(newFact).toBeDefined();
      expect(newFact!.evidence_ids).toContain(evidenceId);

      // sidecar file is committed alongside the dossier
      expect(gitShow(repoRoot, after!, sidecarRelativePath(namespace))).toBeDefined();

      const commitMessage = execFileSync('git', ['-C', repoRoot, 'log', '-1', '--format=%B', after!]).toString();
      expect(commitMessage).toContain(`governed(${namespace}): write idem-1`);
      expect(commitMessage).toContain('Operation-Id: idem-1');
    });

    it('rejects a write with a stale previousRevision', async () => {
      const dossier = readDossierFile(repoRoot);
      const evidenceId = dossier.evidence[0]!.id;
      const write = buildCreateFactWrite(namespace, subject, { previousRevision: 5, idempotencyKey: 'idem-stale', evidenceId });

      await expect(repository.commit(write)).rejects.toThrow(/stale write/);
    });

    it('finds a previously applied revision by idempotency key', async () => {
      const dossier = readDossierFile(repoRoot);
      const evidenceId = dossier.evidence[0]!.id;
      const write = buildCreateFactWrite(namespace, subject, { previousRevision: null, idempotencyKey: 'idem-2', evidenceId });
      await repository.commit(write);

      const found = await repository.findByIdempotencyKey(namespace, asIdempotencyKey('idem-2'));
      expect(found).toBeDefined();
      expect(found!.namespaceRevision).toBe(1);

      const revision = await repository.getRevision(namespace, write.revisionRecord.revisionId);
      expect(revision).toBeDefined();

      const since = await repository.listRevisionsSince(namespace, 0);
      expect(since).toHaveLength(1);
    });

    it('refuses to commit a mutation that would leave the dossier failing @algerknown/core validation', async () => {
      // A fact with zero evidence references is schema-invalid (evidence_ids requires >= 1).
      const write = buildCreateFactWrite(namespace, subject, { previousRevision: null, idempotencyKey: 'idem-invalid', evidenceId: 'no-such-evidence-id' });
      write.edgesUpserted = [];
      write.revisionRecord.diff = write.revisionRecord.diff.filter((d) => d.entityKind === 'node');

      const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current']).toString().trim();
      const before = gitRevParse(repoRoot, branch);

      await expect(repository.commit(write)).rejects.toThrow(/validation/);
      expect(gitRevParse(repoRoot, branch)).toBe(before);
      expect(await repository.getNamespaceRevision(namespace)).toBeNull();
    });

    it('refuses to start if the managed dossier file has unmanaged uncommitted changes', async () => {
      const dossier = readDossierFile(repoRoot);
      const evidenceId = dossier.evidence[0]!.id;
      writeFileAtomic(path.join(repoRoot, binding.path), 'hand-edited: true\n');

      const write = buildCreateFactWrite(namespace, subject, { previousRevision: null, idempotencyKey: 'idem-dirty', evidenceId });
      await expect(repository.commit(write)).rejects.toThrow(/unmanaged, uncommitted changes/);
    });

    it('persists a confidence-changing update, not silently reverting it to 1 on the next read', async () => {
      const dossier = readDossierFile(repoRoot);
      const evidenceId = dossier.evidence[0]!.id;
      const created = buildCreateFactWrite(namespace, subject, { previousRevision: null, idempotencyKey: 'idem-conf-1', evidenceId, confidence: 0.6 });
      await repository.commit(created);

      const priorNode = await repository.getNode(namespace, asNodeId('fact-new-from-test'));
      expect(priorNode!.confidence).toBe(0.6);

      const updated = buildConfidenceUpdateWrite(namespace, subject, { previousRevision: 1, idempotencyKey: 'idem-conf-2', newConfidence: 0.95, priorNode: priorNode! });
      await repository.commit(updated);

      const node = await repository.getNode(namespace, asNodeId('fact-new-from-test'));
      expect(node!.confidence).toBe(0.95);

      // a *fresh* repository instance (re-reading from disk, not any in-memory cache) must see the same thing
      const freshRepository = new GitAlgerknownRepository({ repoRoot, binding });
      const freshNode = await freshRepository.getNode(namespace, asNodeId('fact-new-from-test'));
      expect(freshNode!.confidence).toBe(0.95);
    });

    it('an edge kind-changing update removes the stale native reference from the dossier', async () => {
      const dossier = readDossierFile(repoRoot);
      const evidenceId = dossier.evidence[0]!.id;
      const secondEvidenceId = dossier.evidence[1]!.id;
      // Two evidence_for edges so the fact still has >= 1 reference once one is retargeted.
      const created = buildCreateFactWrite(namespace, subject, { previousRevision: null, idempotencyKey: 'idem-kind-1', evidenceId, secondEvidenceId });
      await repository.commit(created);

      const changingEdgeId = buildEdgeId('evidence_for', asNodeId(evidenceId), asNodeId('fact-new-from-test'));
      const priorEdge = await repository.getEdge(namespace, changingEdgeId);
      expect(priorEdge!.kind).toBe('evidence_for');

      const kindChange = buildEdgeKindChangeWrite(namespace, subject, {
        previousRevision: 1,
        idempotencyKey: 'idem-kind-2',
        priorEdge: { id: changingEdgeId, sourceId: asNodeId(evidenceId), targetId: asNodeId('fact-new-from-test') },
      });
      await repository.commit(kindChange);

      const changedEdge = await repository.getEdge(namespace, changingEdgeId);
      expect(changedEdge!.kind).toBe('derived_from');

      const dossierAfter = readDossierFile(repoRoot);
      const fact = dossierAfter.facts.find((f) => f.id === 'fact-new-from-test')!;
      expect(fact.evidence_ids).not.toContain(evidenceId); // stale native reference must be gone
      expect(fact.evidence_ids).toContain(secondEvidenceId); // the other reference is untouched
    });
  });

  describe('crash recovery', () => {
    it('rolls back working-tree bytes if a recovery marker exists but no commit landed', async () => {
      const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current']).toString().trim();
      const parentSha = gitRevParse(repoRoot, branch)!;
      const originalContent = fs.readFileSync(path.join(repoRoot, binding.path), 'utf-8');

      // Simulate a crash mid-write: marker written, working tree corrupted, no commit made.
      const markerPath = path.join(repoRoot, '.algerknown/governed/.recovery', `${encodeNamespaceForPath(namespace)}.json`);
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(
        markerPath,
        JSON.stringify({ parentSha, paths: [binding.path], previousContent: [originalContent] }),
      );
      fs.writeFileSync(path.join(repoRoot, binding.path), 'CORRUPTED\n');

      const freshRepository = new GitAlgerknownRepository({ repoRoot, binding });
      await freshRepository.getNamespaceRevision(namespace); // any call triggers recovery

      expect(fs.readFileSync(path.join(repoRoot, binding.path), 'utf-8')).toBe(originalContent);
      expect(fs.existsSync(markerPath)).toBe(false);
    });

    it('re-materializes from the landed commit if the branch moved past the marker parent', async () => {
      const dossier = readDossierFile(repoRoot);
      const evidenceId = dossier.evidence[0]!.id;
      const write = buildCreateFactWrite(namespace, subject, { previousRevision: null, idempotencyKey: 'idem-recover', evidenceId });
      await repository.commit(write);

      const branch = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current']).toString().trim();
      const landedSha = gitRevParse(repoRoot, branch)!;
      const expectedContent = gitShow(repoRoot, landedSha, binding.path)!;

      // Simulate a crash *after* the commit landed but *before* materialization completed.
      fs.writeFileSync(path.join(repoRoot, binding.path), 'STALE-PRE-MATERIALIZATION\n');
      const markerPath = path.join(repoRoot, '.algerknown/governed/.recovery', `${encodeNamespaceForPath(namespace)}.json`);
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(
        markerPath,
        JSON.stringify({ parentSha: null, paths: [binding.path], previousContent: ['STALE-PRE-MATERIALIZATION\n'] }),
      );

      const freshRepository = new GitAlgerknownRepository({ repoRoot, binding });
      await freshRepository.getNamespaceRevision(namespace);

      expect(fs.readFileSync(path.join(repoRoot, binding.path), 'utf-8')).toBe(expectedContent);
      expect(fs.existsSync(markerPath)).toBe(false);
    });
  });
});
