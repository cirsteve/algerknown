import type {
  AttestationId,
  EdgeId,
  EventId,
  NodeId,
  OperationId,
  ProposalId,
  RevisionId,
} from '../domain/ids.js';

export interface IdGenerator {
  nextNodeId(): NodeId;
  nextEdgeId(): EdgeId;
  nextRevisionId(): RevisionId;
  nextProposalId(): ProposalId;
  nextAttestationId(): AttestationId;
  nextEventId(): EventId;
  nextOperationId(): OperationId;
}
