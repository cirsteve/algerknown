import type { ActorId, EdgeId, IdempotencyKey, NamespaceId, NodeId, RevisionId } from '../domain/ids.js';
import type { ActorClass } from '../domain/provenance.js';
import type { AuditDirective, NodeLevelDiff } from '../domain/revision.js';
import type { GovernedNode } from '../domain/node.js';
import type { GovernedEdge } from '../domain/edge.js';

/**
 * One immutable, attributable revision of a namespace, produced by exactly
 * one successful write (including reverts, which apply a prior revision's
 * inverse as a new revision).
 */
export interface RevisionRecord {
  namespace: NamespaceId;
  revisionId: RevisionId;
  previousRevision: number | null;
  namespaceRevision: number;
  createdAt: string;
  actorId: ActorId;
  actorClass: ActorClass;
  diff: NodeLevelDiff[];
  idempotencyKey: IdempotencyKey;
  auditDirective?: AuditDirective;
}

/**
 * The single object the orchestrator hands to Repository.commit. Every field
 * has already passed every evaluator; the repository's only job is to persist
 * it atomically alongside the namespace revision bump.
 */
export interface PreparedWrite {
  namespace: NamespaceId;
  previousRevision: number | null;
  resultingRevision: number;
  revisionRecord: RevisionRecord;
  nodesUpserted: GovernedNode[];
  nodesDeleted: NodeId[];
  edgesUpserted: GovernedEdge[];
  edgesDeleted: EdgeId[];
}

export interface Repository {
  getNamespaceRevision(namespace: NamespaceId): Promise<number | null>;
  getNode(namespace: NamespaceId, nodeId: NodeId): Promise<GovernedNode | undefined>;
  getEdge(namespace: NamespaceId, edgeId: EdgeId): Promise<GovernedEdge | undefined>;
  findByIdempotencyKey(namespace: NamespaceId, key: IdempotencyKey): Promise<RevisionRecord | undefined>;
  getRevision(namespace: NamespaceId, revisionId: RevisionId): Promise<RevisionRecord | undefined>;
  /** Atomically persists the prepared write, its revision record, and any audit directive. */
  commit(write: PreparedWrite): Promise<void>;
  /** Ordered ascending by namespaceRevision, exclusive of sinceRevision, for read-model rebuild. */
  listRevisionsSince(namespace: NamespaceId, sinceRevision: number): Promise<RevisionRecord[]>;
}
