import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asEdgeId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asSubjectId,
  ReferenceReadModel,
  WriteOrchestrator,
  rebuildReferenceReadModel,
  type WriteCommand,
} from '../../src/index.js';
import { createTestHarness } from '../fixtures/deps.js';

const namespace = asNamespaceId('memory.community.topic-1');
const subject = asSubjectId('subject-1');

function createNode(nodeId: string, idempotencyKey: string): WriteCommand {
  return {
    namespace,
    subject,
    nodeMutations: [{ op: 'create', nodeId: asNodeId(nodeId), nodeType: 'observation', payload: { description: nodeId }, confidence: 0.7 }],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey(idempotencyKey),
    actorId: asActorId('actor-1'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
  };
}

function createEdge(edgeId: string, sourceId: string, targetId: string, expectedRevision: number, idempotencyKey: string): WriteCommand {
  return {
    namespace,
    subject,
    nodeMutations: [],
    edgeMutations: [{ op: 'create', edgeId: asEdgeId(edgeId), kind: 'derived_from', sourceId: asNodeId(sourceId), targetId: asNodeId(targetId) }],
    expectedNamespaceRevision: expectedRevision,
    idempotencyKey: asIdempotencyKey(idempotencyKey),
    actorId: asActorId('actor-1'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
  };
}

describe('ReferenceReadModel', () => {
  it('projects node rows with namespace/subject/type/content-hash/source-revision', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const readModel = new ReferenceReadModel();

    await orchestrator.write(createNode('n-1', 'idem-1'));
    const [record] = await harness.repository.listRevisionsSince(namespace, 0);
    readModel.ingestRevision(record!);

    const rows = readModel.rows(namespace);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.entityKind).toBe('node');
    if (row.entityKind === 'node') {
      expect(row.namespace).toBe(namespace);
      expect(row.subject).toBe(subject);
      expect(row.type).toBe('observation');
      expect(row.contentHash).toEqual(expect.any(String));
      expect(row.sourceRevision).toEqual(expect.any(String));
    }
  });

  it('projects edge rows with kind/endpoints/source-revision', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const readModel = new ReferenceReadModel();

    await orchestrator.write(createNode('n-1', 'idem-1'));
    await orchestrator.write(createNode('n-2', 'idem-2'));
    await orchestrator.write(createEdge('e-1', 'n-1', 'n-2', 2, 'idem-3'));

    for (const record of await harness.repository.listRevisionsSince(namespace, 0)) {
      readModel.ingestRevision(record);
    }

    const edgeRow = readModel.rows(namespace).find((r) => r.entityKind === 'edge');
    expect(edgeRow).toBeDefined();
    if (edgeRow?.entityKind === 'edge') {
      expect(edgeRow.edgeKind).toBe('derived_from');
      expect(edgeRow.sourceId).toBe(asNodeId('n-1'));
      expect(edgeRow.targetId).toBe(asNodeId('n-2'));
    }
  });

  it('sorts rows deterministically regardless of ingestion order', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    await orchestrator.write(createNode('n-2', 'idem-1'));
    await orchestrator.write(createNode('n-1', 'idem-2'));
    const revisions = await harness.repository.listRevisionsSince(namespace, 0);

    const forward = new ReferenceReadModel();
    for (const r of revisions) forward.ingestRevision(r);

    const reversed = new ReferenceReadModel();
    for (const r of [...revisions].reverse()) reversed.ingestRevision(r);

    expect(forward.rows(namespace)).toEqual(reversed.rows(namespace));
    expect(await forward.digest(namespace)).toBe(await reversed.digest(namespace));
  });

  it('drop-and-rebuild matches the live projection exactly', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const live = new ReferenceReadModel();

    await orchestrator.write(createNode('n-1', 'idem-1'));
    await orchestrator.write(createNode('n-2', 'idem-2'));
    await orchestrator.write(createEdge('e-1', 'n-1', 'n-2', 2, 'idem-3'));

    for (const record of await harness.repository.listRevisionsSince(namespace, 0)) {
      live.ingestRevision(record);
    }

    const rebuilt = await rebuildReferenceReadModel(harness.repository, namespace);

    expect(rebuilt.digest).toBe(await live.digest(namespace));
    expect(rebuilt.rows).toEqual(live.rows(namespace));
  });

  it('drop-and-rebuild detects a mismatch when the live projection missed a revision', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const live = new ReferenceReadModel();

    await orchestrator.write(createNode('n-1', 'idem-1'));
    await orchestrator.write(createNode('n-2', 'idem-2'));

    const [first] = await harness.repository.listRevisionsSince(namespace, 0);
    live.ingestRevision(first!); // deliberately skip the second revision

    const rebuilt = await rebuildReferenceReadModel(harness.repository, namespace);
    expect(rebuilt.digest).not.toBe(await live.digest(namespace));
  });
});
