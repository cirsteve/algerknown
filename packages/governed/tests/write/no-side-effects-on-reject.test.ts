import { describe, expect, it } from 'vitest';
import {
  WriteOrchestrator,
  asActorId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asProcessorId,
  asSubjectId,
  type NamespaceId,
  type WriteCommand,
} from '../../src/index.js';
import { createTestHarness, type TestHarness } from '../fixtures/deps.js';
import { recordSuiteEvidence, trackSuiteFailures } from '../acceptance/evidence-helpers.js';

interface StateSnapshot {
  namespaceRevision: number | null;
  nodeExists: boolean;
  usageCount: number;
  operationSinkCount: number;
}

async function snapshot(harness: TestHarness, namespace: NamespaceId, probeNodeId: ReturnType<typeof asNodeId>, processorId: ReturnType<typeof asProcessorId>): Promise<StateSnapshot> {
  return {
    namespaceRevision: await harness.repository.getNamespaceRevision(namespace),
    nodeExists: (await harness.repository.getNode(namespace, probeNodeId)) !== undefined,
    usageCount: await harness.usageCounter.countInWindow(processorId, 24 * 60 * 60_000, harness.clock.now()),
    operationSinkCount: harness.operationSink.records.filter((r) => r.namespace === namespace).length,
  };
}

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

/**
 * INV1: a rejected write is a pure no-op. For each representative rejection
 * reason across the rail matrix, the namespace revision, the node the write
 * would have created, processor usage accounting, and operation-sink state
 * are all identical before and after the rejected attempt.
 */
describe('INV1: rejected writes have no side effects', () => {
  const cases: { name: string; build: () => { namespace: NamespaceId; command: WriteCommand }; expectedReason: string }[] = [
    {
      name: 'schema validation failure',
      expectedReason: 'SCHEMA_VALIDATION_FAILED',
      build: () => {
        const namespace = asNamespaceId('memory.community.reject-schema');
        return {
          namespace,
          command: {
            namespace,
            subject: asSubjectId('subject-1'),
            nodeMutations: [{ op: 'create', nodeId: asNodeId('n-reject-schema'), nodeType: 'observation', payload: {}, confidence: 0.9 }],
            edgeMutations: [],
            expectedNamespaceRevision: null,
            idempotencyKey: asIdempotencyKey('idem-reject-schema'),
            actorId: asActorId('actor-1'),
            actorClass: 'processor',
            provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
          },
        };
      },
    },
    {
      name: 'missing attestation on a human-gated write',
      expectedReason: 'ATTESTATION_REQUIRED',
      build: () => {
        const namespace = asNamespaceId('canonical.project.reject-attestation');
        return {
          namespace,
          command: {
            namespace,
            subject: asSubjectId('subject-1'),
            nodeMutations: [{ op: 'create', nodeId: asNodeId('n-reject-attestation'), nodeType: 'decision', payload: { statement: 'x' }, confidence: 0.9 }],
            edgeMutations: [],
            expectedNamespaceRevision: null,
            idempotencyKey: asIdempotencyKey('idem-reject-attestation'),
            actorId: asActorId('actor-1'),
            actorClass: 'processor',
            provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
          },
        };
      },
    },
    {
      name: 'confidence below the configured floor',
      expectedReason: 'CONFIDENCE_BELOW_FLOOR',
      build: () => {
        const namespace = asNamespaceId('memory.community.reject-confidence');
        return {
          namespace,
          command: {
            namespace,
            subject: asSubjectId('subject-1'),
            nodeMutations: [{ op: 'create', nodeId: asNodeId('n-reject-confidence'), nodeType: 'observation', payload: { description: 'x' }, confidence: 0.1 }],
            edgeMutations: [],
            expectedNamespaceRevision: null,
            idempotencyKey: asIdempotencyKey('idem-reject-confidence'),
            actorId: asActorId('actor-1'),
            actorClass: 'processor',
            provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
          },
        };
      },
    },
    {
      name: 'append-only violation (update under an append-only namespace)',
      expectedReason: 'APPEND_ONLY_VIOLATION',
      build: () => {
        const namespace = asNamespaceId('operation.reject-append-only');
        return {
          namespace,
          command: {
            namespace,
            subject: asSubjectId('subject-1'),
            nodeMutations: [{ op: 'update', nodeId: asNodeId('n-reject-append-only'), payload: { description: 'x' } }],
            edgeMutations: [],
            expectedNamespaceRevision: null,
            idempotencyKey: asIdempotencyKey('idem-reject-append-only'),
            actorId: asActorId('actor-1'),
            actorClass: 'processor',
            provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
          },
        };
      },
    },
    {
      name: 'truth type placed outside a canonical namespace',
      expectedReason: 'TRUTH_TYPE_REQUIRES_CANONICAL_NAMESPACE',
      build: () => {
        const namespace = asNamespaceId('memory.community.reject-truth-placement');
        return {
          namespace,
          command: {
            namespace,
            subject: asSubjectId('subject-1'),
            nodeMutations: [{ op: 'create', nodeId: asNodeId('n-reject-truth-placement'), nodeType: 'fact', payload: { statement: 'x' }, confidence: 0.9 }],
            edgeMutations: [],
            expectedNamespaceRevision: null,
            idempotencyKey: asIdempotencyKey('idem-reject-truth-placement'),
            actorId: asActorId('actor-1'),
            actorClass: 'processor',
            provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
          },
        };
      },
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name}: repository/usage/operation-sink state is byte-identical before and after`, async () => {
      const harness = createTestHarness();
      const orchestrator = new WriteOrchestrator(harness);
      const { namespace, command } = testCase.build();
      const probeNodeId = command.nodeMutations[0]!.nodeId;
      const processorId = asProcessorId('actor-1');

      const before = await snapshot(harness, namespace, probeNodeId, processorId);
      const result = await orchestrator.write(command);
      expect(result.outcome).toBe('rejected');
      if (result.outcome === 'rejected') {
        expect(result.reasonCodes).toContain(testCase.expectedReason);
      }
      const after = await snapshot(harness, namespace, probeNodeId, processorId);

      expect(after).toEqual(before);
      expect(after.namespaceRevision).toBeNull();
      expect(after.nodeExists).toBe(false);
    });
  }

  it('records inv1-no-side-effects-on-reject evidence once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'inv1-no-side-effects-on-reject',
      suite: 'packages/governed/tests/write/no-side-effects-on-reject.test.ts',
      fixture: 'schema/attestation/confidence/append-only/truth-placement rejections',
      backend: 'in-memory',
      durationMs: Date.now() - suiteStart,
    });
  });
});
