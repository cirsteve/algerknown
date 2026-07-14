import type { NamespaceId, NodeId, SubjectId } from '../domain/ids.js';
import type { GovernedNode } from '../domain/node.js';

export interface ContradictionCandidate {
  namespace: NamespaceId;
  subject: SubjectId;
  candidateNode: GovernedNode;
}

export interface ContradictionMatch {
  nodeId: NodeId;
}

/**
 * Owned by the composition root, never trusted from request payloads: the
 * orchestrator always calls this port itself and loads each returned node to
 * compare confidence before routing a candidate to a proposal.
 */
export interface ContradictionDetector {
  findContradictions(candidate: ContradictionCandidate): Promise<ContradictionMatch[]>;
}
