import type { ActorId, EdgeId, IdempotencyKey, NamespaceId, NodeId, RevisionId, SubjectId } from './ids.js';
import type { EdgeKind } from './edge.js';
import type { NodeType } from './node.js';
import type { ActorClass, SourceReference } from './provenance.js';
import type { AttestationInput } from './attestation.js';

export type NodeMutation =
  | { op: 'create'; nodeId: NodeId; nodeType: NodeType; payload: Record<string, unknown>; confidence: number }
  | { op: 'update'; nodeId: NodeId; payload?: Record<string, unknown>; confidence?: number }
  | { op: 'delete'; nodeId: NodeId }
  | { op: 'revert'; nodeId: NodeId; targetRevisionId: RevisionId };

export type EdgeMutation =
  | { op: 'create'; edgeId: EdgeId; kind: EdgeKind; sourceId: NodeId; targetId: NodeId }
  | { op: 'update'; edgeId: EdgeId; kind: EdgeKind }
  | { op: 'delete'; edgeId: EdgeId }
  | { op: 'revert'; edgeId: EdgeId; targetRevisionId: RevisionId };

export interface ProvenanceInput {
  sources: SourceReference[];
  processorVersion?: string;
  sourceDerived?: boolean;
}

/**
 * A single namespace-scoped command. Every mutation in nodeMutations/edgeMutations
 * is implicitly scoped to `namespace`; the orchestrator rejects commands whose
 * mutations target entities that already live in a different namespace.
 */
export interface WriteCommand {
  namespace: NamespaceId;
  subject: SubjectId;
  nodeMutations: NodeMutation[];
  edgeMutations: EdgeMutation[];
  expectedNamespaceRevision: number | null;
  idempotencyKey: IdempotencyKey;
  actorId: ActorId;
  actorClass: ActorClass;
  provenanceInput: ProvenanceInput;
  attestation?: AttestationInput;
}
