import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOVERNED_CONFIG,
  WriteOrchestrator,
  normalizeWriteCommand,
  asActorId,
  asEdgeId,
  asIdempotencyKey,
  asNodeId,
  asMutationHash,
  type Attestation,
  type AttestationVerifier,
  type Clock,
  type IdGenerator,
  type NamespaceId,
  type Repository,
  type SubjectId,
  type WriteCommand,
  type WriteOrchestratorDeps,
  type WriteResult,
} from '../../src/index.js';
import { InMemoryProposalRepository } from '../fixtures/proposal-repository.js';
import { InMemoryOperationSink } from '../fixtures/operation-sink.js';
import { StubProcessor } from '../fixtures/processor.js';
import { ConfigurableContradictionDetector } from '../fixtures/contradiction-detector.js';
import { InMemoryUsageCounter } from '../fixtures/usage-counter.js';

/**
 * The fixed set of facts the harness asserts against reusable Repository
 * conformance semantics -- never the dossier's field shape or edge-id
 * scheme, which stay entirely inside the adapter under test. See the
 * rejected-approach note in the brief: "Make the conformance harness aware
 * of dossier fields" is exactly what this module must not do.
 */
export interface ConformanceFixture {
  namespace: NamespaceId;
  subject: SubjectId;
  /** An id already present in the seeded backend that can serve as an evidence_for edge source. */
  evidenceId: string;
  /** A second, distinct evidence-source id, so a test can delete one evidence_for reference while leaving a representable (>= 1 reference) record behind. */
  alternateEvidenceId: string;
  /** An id already present in the seeded backend, of type 'fact'. */
  factId: string;
}

export interface AttestationVerifierWithRegistry extends AttestationVerifier {
  register(attestation: Attestation): void;
}

export interface RepositoryConformanceConfig<TContext> {
  /** Seeds a fresh backend instance (e.g. a temp git repo) and returns fixture ids to build representable mutations against. */
  seedFixture: () => Promise<{ context: TContext; fixture: ConformanceFixture }>;
  /** Builds a Repository bound to the seeded context. Called more than once per test to prove a fresh instance reads consistent state (e.g. after simulateCrashMidWrite). */
  createRepository: (context: TContext) => Repository;
  createClock: () => Clock;
  createIdGenerator: () => IdGenerator;
  createAttestationVerifier: () => AttestationVerifierWithRegistry;
  /** Releases whatever seedFixture allocated. */
  teardown?: (context: TContext) => void | Promise<void>;
  /**
   * Backend-specific crash injection: leaves the backend as if a process
   * died partway through a write, without necessarily having attempted one
   * through the orchestrator. Optional because how a crash is simulated is
   * inherently backend-specific; when provided, the failure-recovery case
   * asserts a freshly constructed Repository self-heals to a consistent
   * state.
   */
  simulateCrashMidWrite?: (context: TContext) => Promise<void> | void;
}

interface Harness<TContext> {
  context: TContext;
  fixture: ConformanceFixture;
  repository: Repository;
  deps: WriteOrchestratorDeps & {
    proposalRepository: InMemoryProposalRepository;
    attestationVerifier: AttestationVerifierWithRegistry;
    clock: Clock;
    idGenerator: IdGenerator;
  };
  orchestrator: WriteOrchestrator;
}

async function buildHarness<TContext>(config: RepositoryConformanceConfig<TContext>): Promise<Harness<TContext>> {
  const { context, fixture } = await config.seedFixture();
  const repository = config.createRepository(context);
  const deps = {
    config: DEFAULT_GOVERNED_CONFIG,
    repository,
    proposalRepository: new InMemoryProposalRepository(),
    operationSink: new InMemoryOperationSink(),
    processor: new StubProcessor(),
    contradictionDetector: new ConfigurableContradictionDetector(),
    attestationVerifier: config.createAttestationVerifier(),
    usageCounter: new InMemoryUsageCounter(),
    clock: config.createClock(),
    idGenerator: config.createIdGenerator(),
  };
  const orchestrator = new WriteOrchestrator(deps);
  return { context, fixture, repository, deps, orchestrator };
}

async function proposeAndAttest<TContext>(
  harness: Harness<TContext>,
  command: WriteCommand,
  opts: { corruptMutationHash?: boolean } = {},
): Promise<WriteResult> {
  const { command: normalized, mutationHash } = normalizeWriteCommand(command);
  const proposalId = harness.deps.idGenerator.nextProposalId();
  const attestationId = harness.deps.idGenerator.nextAttestationId();

  await harness.deps.proposalRepository.save({
    id: proposalId,
    canonicalMutation: normalized,
    mutationHash,
    targetNamespace: normalized.namespace,
    targetSubject: normalized.subject,
    expectedTargetRevision: normalized.expectedNamespaceRevision,
    supportingObservationIds: [],
    provenance: { sources: [], railId: 'human-gated', evaluatorVerdicts: [] },
    version: 1,
    status: 'pending',
    events: [],
  });

  harness.deps.attestationVerifier.register({
    id: attestationId,
    reviewerId: asActorId('conformance-reviewer'),
    approvedAt: harness.deps.clock.now(),
    proposalId,
    proposalVersion: 1,
    targetRevision: normalized.expectedNamespaceRevision,
    mutationHash: opts.corruptMutationHash ? asMutationHash('deliberately-wrong-hash') : mutationHash,
    channel: 'conformance-suite',
    verifierMeta: {},
  });

  return harness.orchestrator.write({ ...command, attestation: { attestationId } });
}

function baseCommand<TContext>(harness: Harness<TContext>, overrides: Partial<WriteCommand>): WriteCommand {
  return {
    namespace: harness.fixture.namespace,
    subject: harness.fixture.subject,
    nodeMutations: [],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey('unset'),
    actorId: asActorId('conformance-actor'),
    actorClass: 'human',
    provenanceInput: { sources: [{ kind: 'external', id: harness.fixture.evidenceId }] },
    ...overrides,
  };
}

function createFact<TContext>(
  harness: Harness<TContext>,
  opts: { nodeId: string; edgeId: string; expectedRevision: number | null; idempotencyKey: string; statement: string },
): WriteCommand {
  return baseCommand(harness, {
    nodeMutations: [
      {
        op: 'create',
        nodeId: asNodeId(opts.nodeId),
        nodeType: 'fact',
        payload: { statement: opts.statement, attributes: { status: 'shipped', safe_phrasings: [opts.statement] } },
        confidence: 1,
      },
    ],
    edgeMutations: [
      {
        op: 'create',
        edgeId: asEdgeId(opts.edgeId),
        kind: 'evidence_for',
        sourceId: asNodeId(harness.fixture.evidenceId),
        targetId: asNodeId(opts.nodeId),
      },
    ],
    expectedNamespaceRevision: opts.expectedRevision,
    idempotencyKey: asIdempotencyKey(opts.idempotencyKey),
  });
}

/**
 * Runs the reusable Repository conformance suite against `config`. Register
 * this against any backend implementation (git, later sqlite, ...) that
 * conforms to the governed Repository port bound to a canonical.project.*
 * namespace under the human-gated policy.
 */
export function runRepositoryConformanceSuite<TContext>(config: RepositoryConformanceConfig<TContext>): void {
  async function teardown(harness: Harness<TContext>): Promise<void> {
    await config.teardown?.(harness.context);
  }

  describe('repository conformance', () => {
    it('reads: namespace revision is null and existing fixture records are reachable before any governed write', async () => {
      const harness = await buildHarness(config);
      try {
        expect(await harness.repository.getNamespaceRevision(harness.fixture.namespace)).toBeNull();

        const fact = await harness.repository.getNode(harness.fixture.namespace, asNodeId(harness.fixture.factId));
        expect(fact).toBeDefined();
        expect(fact!.type).toBe('fact');

        expect(await harness.repository.getNode(harness.fixture.namespace, asNodeId('no-such-node'))).toBeUndefined();
        expect(await harness.repository.getEdge(harness.fixture.namespace, asEdgeId('no-such-edge'))).toBeUndefined();
      } finally {
        await teardown(harness);
      }
    });

    it('representable create: applies a new fact node plus its evidence_for edge', async () => {
      const harness = await buildHarness(config);
      try {
        const result = await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-1', edgeId: 'conf-edge-1', expectedRevision: null, idempotencyKey: 'idem-create', statement: 'A representable fact.' }),
        );
        expect(result.outcome).toBe('applied');

        const node = await harness.repository.getNode(harness.fixture.namespace, asNodeId('fact-conf-1'));
        expect(node).toBeDefined();
        expect((node!.payload as unknown as { statement: string }).statement).toBe('A representable fact.');
        expect(await harness.repository.getNamespaceRevision(harness.fixture.namespace)).toBe(1);
      } finally {
        await teardown(harness);
      }
    });

    it('representable update: mutates an existing node payload', async () => {
      const harness = await buildHarness(config);
      try {
        await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-2', edgeId: 'conf-edge-2', expectedRevision: null, idempotencyKey: 'idem-u1', statement: 'Original statement.' }),
        );

        const update = baseCommand(harness, {
          nodeMutations: [{ op: 'update', nodeId: asNodeId('fact-conf-2'), payload: { statement: 'Updated statement.', attributes: { status: 'shipped', safe_phrasings: ['Updated statement.'] } } }],
          expectedNamespaceRevision: 1,
          idempotencyKey: asIdempotencyKey('idem-u2'),
        });
        const result = await proposeAndAttest(harness, update);
        expect(result.outcome).toBe('applied');

        const node = await harness.repository.getNode(harness.fixture.namespace, asNodeId('fact-conf-2'));
        expect((node!.payload as unknown as { statement: string }).statement).toBe('Updated statement.');
      } finally {
        await teardown(harness);
      }
    });

    it('representable delete: removes a node', async () => {
      const harness = await buildHarness(config);
      try {
        await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-3', edgeId: 'conf-edge-3', expectedRevision: null, idempotencyKey: 'idem-d1', statement: 'To be deleted.' }),
        );

        const del = baseCommand(harness, {
          nodeMutations: [{ op: 'delete', nodeId: asNodeId('fact-conf-3') }],
          expectedNamespaceRevision: 1,
          idempotencyKey: asIdempotencyKey('idem-d2'),
        });
        const result = await proposeAndAttest(harness, del);
        expect(result.outcome).toBe('applied');

        expect(await harness.repository.getNode(harness.fixture.namespace, asNodeId('fact-conf-3'))).toBeUndefined();
      } finally {
        await teardown(harness);
      }
    });

    it('expected-revision conflict: a stale expectedNamespaceRevision is rejected without advancing the namespace', async () => {
      const harness = await buildHarness(config);
      try {
        await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-4', edgeId: 'conf-edge-4', expectedRevision: null, idempotencyKey: 'idem-c1', statement: 'First.' }),
        );

        const stale = createFact(harness, { nodeId: 'fact-conf-5', edgeId: 'conf-edge-5', expectedRevision: 0, idempotencyKey: 'idem-c2', statement: 'Should conflict.' });
        const result = await proposeAndAttest(harness, stale);

        expect(result.outcome).toBe('conflict');
        expect(await harness.repository.getNamespaceRevision(harness.fixture.namespace)).toBe(1);
        expect(await harness.repository.getNode(harness.fixture.namespace, asNodeId('fact-conf-5'))).toBeUndefined();
      } finally {
        await teardown(harness);
      }
    });

    it('exact idempotent replay: resubmitting the same idempotency key returns the original result without a second write', async () => {
      const harness = await buildHarness(config);
      try {
        const command = createFact(harness, { nodeId: 'fact-conf-6', edgeId: 'conf-edge-6', expectedRevision: null, idempotencyKey: 'idem-replay', statement: 'Replayed.' });

        const first = await proposeAndAttest(harness, command);
        expect(first.outcome).toBe('applied');

        const second = await harness.orchestrator.write(command); // no fresh proposal/attestation needed for a pure replay
        expect(second.outcome).toBe('idempotent_replay');
        if (first.outcome !== 'applied') throw new Error('expected first write to apply');
        if (second.outcome !== 'idempotent_replay') throw new Error('expected second write to replay');
        if (second.original.outcome !== 'applied') throw new Error('expected replayed original to have applied');
        expect(second.original.diff).toEqual(first.diff);
        expect(second.original.resultingRevision).toBe(first.resultingRevision);

        expect(await harness.repository.getNamespaceRevision(harness.fixture.namespace)).toBe(1);
      } finally {
        await teardown(harness);
      }
    });

    it('mismatch rejection: an attestation whose mutation hash does not match the command is rejected, not applied', async () => {
      const harness = await buildHarness(config);
      try {
        const command = createFact(harness, { nodeId: 'fact-conf-7', edgeId: 'conf-edge-7', expectedRevision: null, idempotencyKey: 'idem-mismatch', statement: 'Should be rejected.' });
        const result = await proposeAndAttest(harness, command, { corruptMutationHash: true });

        expect(result.outcome).toBe('rejected');
        expect(await harness.repository.getNamespaceRevision(harness.fixture.namespace)).toBeNull();
        expect(await harness.repository.getNode(harness.fixture.namespace, asNodeId('fact-conf-7'))).toBeUndefined();
      } finally {
        await teardown(harness);
      }
    });

    it('node diff/history: getRevision and listRevisionsSince reconstruct applied writes in order', async () => {
      const harness = await buildHarness(config);
      try {
        await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-8', edgeId: 'conf-edge-8', expectedRevision: null, idempotencyKey: 'idem-h1', statement: 'First.' }),
        );
        await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-9', edgeId: 'conf-edge-9', expectedRevision: 1, idempotencyKey: 'idem-h2', statement: 'Second.' }),
        );

        const history = await harness.repository.listRevisionsSince(harness.fixture.namespace, 0);
        expect(history).toHaveLength(2);
        expect(history[0]!.namespaceRevision).toBe(1);
        expect(history[1]!.namespaceRevision).toBe(2);
        expect(history[0]!.diff.length).toBeGreaterThan(0);

        const revisionRecord = history[0]!;
        const byId = await harness.repository.getRevision(harness.fixture.namespace, revisionRecord.revisionId);
        expect(byId).toBeDefined();
        expect(byId!.diff).toEqual(revisionRecord.diff);
      } finally {
        await teardown(harness);
      }
    });

    it('native edges: an evidence_for edge round-trips through create and delete', async () => {
      const harness = await buildHarness(config);
      try {
        // The fact is created with two evidence_for edges so deleting one
        // still leaves a representable (>= 1 reference) record behind.
        const create = createFact(harness, { nodeId: 'fact-conf-10', edgeId: 'conf-edge-10', expectedRevision: null, idempotencyKey: 'idem-native-1', statement: 'Natively cited.' });
        create.edgeMutations.push({
          op: 'create',
          edgeId: asEdgeId('conf-edge-10b'),
          kind: 'evidence_for',
          sourceId: asNodeId(harness.fixture.alternateEvidenceId),
          targetId: asNodeId('fact-conf-10'),
        });
        await proposeAndAttest(harness, create);

        const edgeId = asEdgeId('conf-edge-10');
        const created = await harness.repository.getEdge(harness.fixture.namespace, edgeId);
        expect(created).toBeDefined();
        expect(created!.kind).toBe('evidence_for');

        const del = baseCommand(harness, {
          edgeMutations: [{ op: 'delete', edgeId }],
          expectedNamespaceRevision: 1,
          idempotencyKey: asIdempotencyKey('idem-native-2'),
        });
        const result = await proposeAndAttest(harness, del);
        expect(result.outcome).toBe('applied');
        expect(await harness.repository.getEdge(harness.fixture.namespace, edgeId)).toBeUndefined();

        // the other evidence_for edge into the same fact must be unaffected
        const remaining = await harness.repository.getEdge(harness.fixture.namespace, asEdgeId('conf-edge-10b'));
        expect(remaining).toBeDefined();
      } finally {
        await teardown(harness);
      }
    });

    it('sidecar edges: a derived_from edge (no dossier-field representation) round-trips through create and delete', async () => {
      const harness = await buildHarness(config);
      try {
        await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-11a', edgeId: 'conf-edge-11a', expectedRevision: null, idempotencyKey: 'idem-sc-1', statement: 'Source fact.' }),
        );
        await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-11b', edgeId: 'conf-edge-11b', expectedRevision: 1, idempotencyKey: 'idem-sc-2', statement: 'Derived fact.' }),
        );

        const derivedEdgeId = asEdgeId('conf-edge-derived-1');
        const createDerived = baseCommand(harness, {
          edgeMutations: [{ op: 'create', edgeId: derivedEdgeId, kind: 'derived_from', sourceId: asNodeId('fact-conf-11b'), targetId: asNodeId('fact-conf-11a') }],
          expectedNamespaceRevision: 2,
          idempotencyKey: asIdempotencyKey('idem-sc-3'),
        });
        const created = await proposeAndAttest(harness, createDerived);
        expect(created.outcome).toBe('applied');

        const edge = await harness.repository.getEdge(harness.fixture.namespace, derivedEdgeId);
        expect(edge).toBeDefined();
        expect(edge!.kind).toBe('derived_from');

        const del = baseCommand(harness, {
          edgeMutations: [{ op: 'delete', edgeId: derivedEdgeId }],
          expectedNamespaceRevision: 3,
          idempotencyKey: asIdempotencyKey('idem-sc-4'),
        });
        const result = await proposeAndAttest(harness, del);
        expect(result.outcome).toBe('applied');
        expect(await harness.repository.getEdge(harness.fixture.namespace, derivedEdgeId)).toBeUndefined();
      } finally {
        await teardown(harness);
      }
    });

    it('attribution: a created node carries the actor and provenance sources supplied on the command', async () => {
      const harness = await buildHarness(config);
      try {
        const command = baseCommand(harness, {
          nodeMutations: [{ op: 'create', nodeId: asNodeId('fact-conf-12'), nodeType: 'fact', payload: { statement: 'Attributed.', attributes: { status: 'shipped', safe_phrasings: ['Attributed.'] } }, confidence: 1 }],
          edgeMutations: [{ op: 'create', edgeId: asEdgeId('conf-edge-12'), kind: 'evidence_for', sourceId: asNodeId(harness.fixture.evidenceId), targetId: asNodeId('fact-conf-12') }],
          idempotencyKey: asIdempotencyKey('idem-attr'),
          actorId: asActorId('a-specific-reviewer'),
          actorClass: 'human',
          provenanceInput: { sources: [{ kind: 'external', id: harness.fixture.evidenceId, locator: 'conformance-locator' }] },
        });

        await proposeAndAttest(harness, command);

        const node = await harness.repository.getNode(harness.fixture.namespace, asNodeId('fact-conf-12'));
        expect(node).toBeDefined();
        expect(String(node!.revision.actorId)).toBe('a-specific-reviewer');
        expect(node!.revision.actorClass).toBe('human');
        expect(node!.provenance.sources.some((s) => s.locator === 'conformance-locator')).toBe(true);
      } finally {
        await teardown(harness);
      }
    });

    it('revert: applying the stored inverse of a create adds a new revision and removes the node, preserving history', async () => {
      const harness = await buildHarness(config);
      try {
        const created = await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-13', edgeId: 'conf-edge-13', expectedRevision: null, idempotencyKey: 'idem-rev-1', statement: 'Will be reverted.' }),
        );
        if (created.outcome !== 'applied') throw new Error('expected create to apply');

        const createdRevisionRecord = (await harness.repository.listRevisionsSince(harness.fixture.namespace, 0))[0]!;

        const revert = baseCommand(harness, {
          nodeMutations: [{ op: 'revert', nodeId: asNodeId('fact-conf-13'), targetRevisionId: createdRevisionRecord.revisionId }],
          expectedNamespaceRevision: 1,
          idempotencyKey: asIdempotencyKey('idem-rev-2'),
        });
        const result = await proposeAndAttest(harness, revert);
        expect(result.outcome).toBe('applied');

        expect(await harness.repository.getNode(harness.fixture.namespace, asNodeId('fact-conf-13'))).toBeUndefined();

        const history = await harness.repository.listRevisionsSince(harness.fixture.namespace, 0);
        expect(history).toHaveLength(2);
        expect(history[1]!.diff.some((d) => d.changeKind === 'revert')).toBe(true);

        // the reverted-from revision itself is untouched -- reversal adds history, never rewrites it
        const stillThere = await harness.repository.getRevision(harness.fixture.namespace, createdRevisionRecord.revisionId);
        expect(stillThere).toEqual(createdRevisionRecord);
      } finally {
        await teardown(harness);
      }
    });

    it.skipIf(!config.simulateCrashMidWrite)('failure recovery: a fresh Repository instance self-heals after a simulated crash', async () => {
      const harness = await buildHarness(config);
      try {
        await proposeAndAttest(
          harness,
          createFact(harness, { nodeId: 'fact-conf-14', edgeId: 'conf-edge-14', expectedRevision: null, idempotencyKey: 'idem-recover-1', statement: 'Before crash.' }),
        );

        await config.simulateCrashMidWrite!(harness.context);

        const recovered = config.createRepository(harness.context);
        expect(await recovered.getNamespaceRevision(harness.fixture.namespace)).toBe(1);
        expect(await recovered.getNode(harness.fixture.namespace, asNodeId('fact-conf-14'))).toBeDefined();
      } finally {
        await teardown(harness);
      }
    });
  });
}
