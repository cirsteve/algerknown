import {
  asAttestationId,
  asEdgeId,
  asEventId,
  asNodeId,
  asOperationId,
  asProposalId,
  asRevisionId,
  type IdGenerator,
} from '../../src/index.js';

/** Deterministic, sequential id generator so fixture output is reproducible across runs. */
export function createTestIdGenerator(prefix = 'id'): IdGenerator {
  let counter = 0;
  const next = () => `${prefix}-${++counter}`;
  return {
    nextNodeId: () => asNodeId(next()),
    nextEdgeId: () => asEdgeId(next()),
    nextRevisionId: () => asRevisionId(next()),
    nextProposalId: () => asProposalId(next()),
    nextAttestationId: () => asAttestationId(next()),
    nextEventId: () => asEventId(next()),
    nextOperationId: () => asOperationId(next()),
  };
}
