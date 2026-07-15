import type { ActorId, NamespaceId, NodeId, EdgeId, ProcessorId, RevisionId } from './ids.js';
import type { ActorClass } from './provenance.js';

export interface RevisionMeta {
  revisionId: RevisionId;
  namespaceRevision: number;
  createdAt: string;
  actorId: ActorId;
  actorClass: ActorClass;
}

export type DiffEntityKind = 'node' | 'edge';
export type DiffChangeKind = 'create' | 'update' | 'delete' | 'revert';

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface NodeLevelDiff {
  entityKind: DiffEntityKind;
  entityId: NodeId | EdgeId;
  changeKind: DiffChangeKind;
  forward: FieldChange[];
  inverse: FieldChange[];
}

export interface AuditDirective {
  sampled: boolean;
  namespace: NamespaceId;
  processorId?: ProcessorId;
  every: number;
  sampleIndex: number;
}
