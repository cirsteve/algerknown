import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asSubjectId,
  InMemoryReadModel,
  InMemoryRebuildCoordinator,
  WriteOrchestrator,
  type WriteCommand,
} from '../../src/index.js';
import { createTestHarness } from '../fixtures/deps.js';

const namespace = asNamespaceId('memory.community.topic-1');

function commandFor(nodeId: string, idempotencyKey: string): WriteCommand {
  return {
    namespace,
    subject: asSubjectId('subject-1'),
    nodeMutations: [
      { op: 'create', nodeId: asNodeId(nodeId), nodeType: 'observation', payload: { description: nodeId }, confidence: 0.7 },
    ],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey(idempotencyKey),
    actorId: asActorId('actor-1'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
  };
}

describe('read-model rebuild', () => {
  it('matches the live projection once every revision has been ingested', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const readModel = new InMemoryReadModel();
    const coordinator = new InMemoryRebuildCoordinator(harness.repository, readModel);

    await orchestrator.write(commandFor('n-1', 'idem-1'));
    await orchestrator.write(commandFor('n-2', 'idem-2'));

    for (const record of await harness.repository.listRevisionsSince(namespace, 0)) {
      readModel.ingestRevision(record);
    }

    const result = await coordinator.rebuild({ namespace, sinceRevision: 0 });
    expect(result.finalRevision).toBe(2);
    expect(result.matchesLiveProjection).toBe(true);
    expect(result.digest).toEqual(expect.any(String));
    expect(result.digest.length).toBeGreaterThan(0);
  });

  it('detects a mismatch when the live projection missed a revision', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const readModel = new InMemoryReadModel();
    const coordinator = new InMemoryRebuildCoordinator(harness.repository, readModel);

    await orchestrator.write(commandFor('n-1', 'idem-1'));
    await orchestrator.write(commandFor('n-2', 'idem-2'));

    const [first] = await harness.repository.listRevisionsSince(namespace, 0);
    readModel.ingestRevision(first!);

    const result = await coordinator.rebuild({ namespace, sinceRevision: 0 });
    expect(result.matchesLiveProjection).toBe(false);
  });

  it('rebuilds deterministically from a mid-history checkpoint', async () => {
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const readModel = new InMemoryReadModel();
    const coordinator = new InMemoryRebuildCoordinator(harness.repository, readModel);

    await orchestrator.write(commandFor('n-1', 'idem-1'));
    await orchestrator.write(commandFor('n-2', 'idem-2'));
    await orchestrator.write(commandFor('n-3', 'idem-3'));

    const first = await coordinator.rebuild({ namespace, sinceRevision: 1 });
    const second = await coordinator.rebuild({ namespace, sinceRevision: 1 });
    expect(first.digest).toBe(second.digest);
    expect(first.finalRevision).toBe(3);
  });

  it('still matches the live projection when rebuilding from a non-zero checkpoint', async () => {
    // A partial replay starting empty at a mid-history checkpoint could never
    // legitimately match a full live-projection digest; the coordinator must
    // always reconstruct full history regardless of the checkpoint given.
    const harness = createTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const readModel = new InMemoryReadModel();
    const coordinator = new InMemoryRebuildCoordinator(harness.repository, readModel);

    await orchestrator.write(commandFor('n-1', 'idem-1'));
    await orchestrator.write(commandFor('n-2', 'idem-2'));
    await orchestrator.write(commandFor('n-3', 'idem-3'));

    for (const record of await harness.repository.listRevisionsSince(namespace, 0)) {
      readModel.ingestRevision(record);
    }

    const result = await coordinator.rebuild({ namespace, sinceRevision: 1 });
    expect(result.matchesLiveProjection).toBe(true);
  });
});
