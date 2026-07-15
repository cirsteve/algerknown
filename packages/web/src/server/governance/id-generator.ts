import { randomUUID } from 'node:crypto';
import {
  asAttestationId,
  asEdgeId,
  asEventId,
  asNodeId,
  asOperationId,
  asProposalId,
  asRevisionId,
  type IdGenerator,
} from '@algerknown/governed';

export function createUuidIdGenerator(): IdGenerator {
  return {
    nextNodeId: () => asNodeId(randomUUID()),
    nextEdgeId: () => asEdgeId(randomUUID()),
    nextRevisionId: () => asRevisionId(randomUUID()),
    nextProposalId: () => asProposalId(randomUUID()),
    nextAttestationId: () => asAttestationId(randomUUID()),
    nextEventId: () => asEventId(randomUUID()),
    nextOperationId: () => asOperationId(randomUUID()),
  };
}
