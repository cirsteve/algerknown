import type { NamespaceId, NodeId, SubjectId } from '../domain/ids.js';
import type { NodeType } from '../domain/node.js';

/**
 * A not-yet-applied candidate node. Deliberately lighter than GovernedNode:
 * at contradiction-check time no revision has been minted yet.
 */
export interface ContradictionCandidateNode {
  id: NodeId;
  type: NodeType;
  namespace: NamespaceId;
  subject: SubjectId;
  payload: Record<string, unknown>;
  confidence: number;
}

export interface ContradictionCandidate {
  namespace: NamespaceId;
  subject: SubjectId;
  candidateNode: ContradictionCandidateNode;
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
