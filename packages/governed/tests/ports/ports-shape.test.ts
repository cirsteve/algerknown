import { describe, expect, it } from 'vitest';
import {
  asAttestationId,
  asEdgeId,
  asEventId,
  asNamespaceId,
  asNodeId,
  asOperationId,
  asProcessorId,
  asProposalId,
  asRevisionId,
} from '../../src/domain/index.js';
import type {
  Clock,
  IdGenerator,
  Repository,
  ProposalRepository,
  OperationSink,
  Processor,
  ContradictionDetector,
  AttestationVerifier,
  UsageCounter,
  ReadModel,
  RebuildCoordinator,
} from '../../src/ports/index.js';

describe('port interfaces', () => {
  it('a minimal Clock implementation type-checks and runs', () => {
    const clock: Clock = { now: () => '2026-01-01T00:00:00.000Z' };
    expect(clock.now()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('a minimal UsageCounter implementation type-checks and runs', async () => {
    const counter: UsageCounter = {
      countInWindow: async () => 0,
      record: async () => undefined,
    };
    await expect(counter.countInWindow(asProcessorId('proc-1'), 60_000, '2026-01-01T00:00:00.000Z')).resolves.toBe(0);
  });

  it('a minimal ReadModel and RebuildCoordinator type-check', async () => {
    const readModel: ReadModel = { digest: async () => 'abc' };
    const rebuild: RebuildCoordinator = {
      rebuild: async (checkpoint) => ({
        namespace: checkpoint.namespace,
        finalRevision: checkpoint.sinceRevision,
        digest: await readModel.digest(checkpoint.namespace),
        matchesLiveProjection: true,
      }),
    };
    const result = await rebuild.rebuild({ namespace: asNamespaceId('canonical.global'), sinceRevision: 0 });
    expect(result.matchesLiveProjection).toBe(true);
  });

  it('accepts stub implementations for every remaining port without compile errors', () => {
    const idGenerator: IdGenerator = {
      nextNodeId: () => asNodeId('n'),
      nextEdgeId: () => asEdgeId('e'),
      nextRevisionId: () => asRevisionId('r'),
      nextProposalId: () => asProposalId('p'),
      nextAttestationId: () => asAttestationId('a'),
      nextEventId: () => asEventId('ev'),
      nextOperationId: () => asOperationId('op'),
    };
    expect(typeof idGenerator.nextNodeId).toBe('function');

    const repository: Repository = {
      getNamespaceRevision: async () => null,
      getNode: async () => undefined,
      getEdge: async () => undefined,
      findByIdempotencyKey: async () => undefined,
      getRevision: async () => undefined,
      commit: async () => undefined,
      listRevisionsSince: async () => [],
    };
    expect(typeof repository.commit).toBe('function');

    const proposalRepository: ProposalRepository = {
      save: async () => undefined,
      get: async () => undefined,
      findPendingByMutationHash: async () => undefined,
    };
    expect(typeof proposalRepository.save).toBe('function');

    const operationSink: OperationSink = { append: async () => undefined };
    expect(typeof operationSink.append).toBe('function');

    const processor: Processor = { describe: async () => undefined };
    expect(typeof processor.describe).toBe('function');

    const contradictionDetector: ContradictionDetector = { findContradictions: async () => [] };
    expect(typeof contradictionDetector.findContradictions).toBe('function');

    const attestationVerifier: AttestationVerifier = { verify: async () => undefined };
    expect(typeof attestationVerifier.verify).toBe('function');
  });
});
