import type { NodeHistoryResponse, ProposalDetail, ProposalQueueItem } from '../../../src/client/lib/governanceApi';

/**
 * One pending proposal shaped exactly like buildCandidateProposeInput's
 * output (see packages/web/src/server/governance/candidate-mapping.ts):
 * a source-entry anchor observation, a learning observation and a decision,
 * each linked back to the anchor by a derived_from edge -- so the fixture
 * exercises both the generic node/edge diff and the Summary adapter that
 * reconstructs learnings/decisions from payload.context.recordKind.
 */
export const PENDING_PROPOSAL_ID = 'prop-1';

export const pendingProposalDetail: ProposalDetail = {
  id: PENDING_PROPOSAL_ID,
  status: 'pending',
  version: 1,
  targetNamespace: 'memory.project.demo',
  targetSubject: 'algerknown.summary:demo-dossier:memory',
  currentTargetRevision: 3,
  expectedTargetRevision: 3,
  canonicalMutation: {
    namespace: 'memory.project.demo',
    subject: 'algerknown.summary:demo-dossier:memory',
    nodeMutations: [
      {
        op: 'create',
        nodeId: 'entry-observation:entry-1',
        nodeType: 'observation',
        payload: {
          description: 'Source entry: entry-1',
          context: { recordKind: 'source-entry', entryId: 'entry-1', path: 'entries/entry-1.yaml', commit: 'abc123' },
        },
        confidence: 1,
      },
      {
        op: 'create',
        nodeId: 'node-1',
        nodeType: 'observation',
        payload: {
          description: 'The demo pipeline is fast.',
          context: { recordKind: 'learning', context: 'from entry-1', relevance: [] },
        },
        confidence: 0.8,
      },
      {
        op: 'create',
        nodeId: 'node-2',
        nodeType: 'decision',
        payload: { statement: 'Use the demo pipeline.', rationale: 'Benchmarks look good.', alternatives: [] },
        confidence: 0.8,
      },
    ],
    edgeMutations: [
      { op: 'create', edgeId: 'derived_from:node-1:entry-observation:entry-1', kind: 'derived_from', sourceId: 'node-1', targetId: 'entry-observation:entry-1' },
      { op: 'create', edgeId: 'derived_from:node-2:entry-observation:entry-1', kind: 'derived_from', sourceId: 'node-2', targetId: 'entry-observation:entry-1' },
    ],
    expectedNamespaceRevision: 3,
    idempotencyKey: 'job-1:candidate-0:hash-abc',
    actorId: 'rag-processor',
    actorClass: 'processor',
    provenanceInput: {
      sources: [{ kind: 'external', id: 'entry-1', locator: 'entries/entry-1.yaml' }],
      processorId: 'rag-processor',
      processorVersion: '1.0.0',
      sourceDerived: true,
    },
  },
  mutationHash: 'hash-abc',
  fingerprint: 'fp-abc',
  supportingObservationIds: ['entry-observation:entry-1'],
  provenance: {
    sources: [{ kind: 'external', id: 'entry-1', locator: 'entries/entry-1.yaml' }],
    processorId: 'rag-processor',
    processorVersion: '1.0.0',
    railId: 'human-gated',
    evaluatorVerdicts: [
      { evaluator: 'schema-type', passed: true, reasonCodes: [] },
      { evaluator: 'confidence-volume', passed: true, reasonCodes: [] },
      { evaluator: 'contradiction', passed: true, reasonCodes: [] },
      { evaluator: 'provenance-support', passed: true, reasonCodes: [] },
    ],
    sourceDerived: true,
  },
  conflict: { stale: false },
  resultingRevision: null,
  reverted: false,
  reversal: null,
  events: [{ eventId: 'evt-1', proposalId: PENDING_PROPOSAL_ID, kind: 'proposed', at: '2026-01-01T00:00:00.000Z', actorId: 'rag-processor', proposalVersion: 1 }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const pendingProposalQueueItem: ProposalQueueItem = {
  id: PENDING_PROPOSAL_ID,
  targetNamespace: pendingProposalDetail.targetNamespace,
  targetSubject: pendingProposalDetail.targetSubject,
  status: 'pending',
  version: 1,
  createdAt: pendingProposalDetail.createdAt,
  updatedAt: pendingProposalDetail.updatedAt,
  resultingRevision: null,
  reverted: false,
};

export const node1HistoryResponse: NodeHistoryResponse = {
  revisions: [
    {
      namespace: 'memory.project.demo',
      revisionId: 'rev-1',
      previousRevision: 2,
      namespaceRevision: 3,
      createdAt: '2025-12-31T00:00:00.000Z',
      actorId: 'steve',
      actorClass: 'human',
      diff: [
        {
          entityKind: 'node',
          entityId: 'node-1',
          changeKind: 'create',
          forward: [{ path: '/payload/description', before: null, after: 'An earlier observation.' }],
          inverse: [{ path: '/payload/description', before: 'An earlier observation.', after: null }],
        },
      ],
      idempotencyKey: 'accept-0',
    },
  ],
};

export function acceptedProposalDetail(overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    ...pendingProposalDetail,
    status: 'accepted',
    version: 2,
    resultingRevision: 4,
    reverted: false,
    ...overrides,
  };
}
