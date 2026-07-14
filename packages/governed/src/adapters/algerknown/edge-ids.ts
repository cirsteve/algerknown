import { asEdgeId } from '../../domain/ids.js';
import type { EdgeId, NodeId } from '../../domain/ids.js';
import type { EdgeKind } from '../../domain/edge.js';

/**
 * Deterministic edge ids derived from kind and endpoints, so the same dossier
 * reference always maps to the same edge id across reads and restarts, and a
 * delete (which the Repository port only carries as an EdgeId) can be traced
 * back to the kind/endpoints it removes.
 */
export function buildEdgeId(kind: EdgeKind, sourceId: NodeId, targetId: NodeId): EdgeId {
  return asEdgeId(`${kind}:${sourceId}:${targetId}`);
}

export interface ParsedEdgeId {
  kind: EdgeKind;
  sourceId: NodeId;
  targetId: NodeId;
}

export function parseEdgeId(edgeId: EdgeId): ParsedEdgeId {
  const parts = String(edgeId).split(':');
  if (parts.length !== 3) {
    throw new Error(`edge id "${edgeId}" is not a deterministic kind:source:target id this adapter generated`);
  }
  const [kind, sourceId, targetId] = parts as [EdgeKind, string, string];
  return { kind, sourceId: sourceId as NodeId, targetId: targetId as NodeId };
}

/** Edge kinds fully derivable from current dossier field content; never persisted to the sidecar. */
export const NATIVE_EDGE_KINDS: readonly EdgeKind[] = ['evidence_for', 'about'];

/** Edge kinds with no dossier-field representation; persisted only in the namespace sidecar. */
export const SIDECAR_EDGE_KINDS: readonly EdgeKind[] = ['derived_from', 'contradicts', 'supersedes'];

export function isNativeEdgeKind(kind: EdgeKind): boolean {
  return (NATIVE_EDGE_KINDS as EdgeKind[]).includes(kind);
}
