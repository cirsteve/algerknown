import type { EdgeId, NamespaceId, NodeId } from './ids.js';
import type { Provenance } from './provenance.js';
import type { RevisionMeta } from './revision.js';

export type EdgeKind = 'derived_from' | 'contradicts' | 'supersedes' | 'about' | 'evidence_for';

export const EDGE_KINDS: readonly EdgeKind[] = [
  'derived_from',
  'contradicts',
  'supersedes',
  'about',
  'evidence_for',
];

export interface GovernedEdge {
  id: EdgeId;
  kind: EdgeKind;
  namespace: NamespaceId;
  sourceId: NodeId;
  targetId: NodeId;
  provenance: Provenance;
  revision: RevisionMeta;
}

export interface EdgeCreateInput {
  id: EdgeId;
  kind: EdgeKind;
  namespace: NamespaceId;
  sourceId: NodeId;
  targetId: NodeId;
}

export interface EdgePatchInput {
  kind?: EdgeKind;
}
