import { createHash } from 'node:crypto';
import type { EdgeId, NodeId } from '../domain/ids.js';
import type { GovernedEdge } from '../domain/edge.js';
import type { GovernedNode } from '../domain/node.js';
import type { NodeLevelDiff } from '../domain/revision.js';

export interface ReplayState {
  nodes: Map<NodeId, GovernedNode>;
  edges: Map<EdgeId, GovernedEdge>;
}

export function createEmptyReplayState(): ReplayState {
  return { nodes: new Map(), edges: new Map() };
}

/** Deterministically folds one node-level diff entry into a replay state, mirroring what a real projection replay does. */
export function applyNodeDiffEntry(state: ReplayState, entry: NodeLevelDiff): void {
  const id = entry.entityId as NodeId;
  const fullSnapshot = entry.forward.find((f) => f.path === '$');
  if (fullSnapshot) {
    if (fullSnapshot.after === null) {
      state.nodes.delete(id);
    } else {
      state.nodes.set(id, fullSnapshot.after as GovernedNode);
    }
    return;
  }
  const existing = state.nodes.get(id);
  if (!existing) return;
  const payload: Record<string, unknown> = { ...(existing.payload as unknown as Record<string, unknown>) };
  let confidence = existing.confidence;
  for (const change of entry.forward) {
    if (change.path === 'confidence') {
      confidence = change.after as number;
    } else if (change.path.startsWith('payload.')) {
      payload[change.path.slice('payload.'.length)] = change.after;
    }
  }
  state.nodes.set(id, { ...existing, payload, confidence } as unknown as GovernedNode);
}

export function applyEdgeDiffEntry(state: ReplayState, entry: NodeLevelDiff): void {
  const id = entry.entityId as EdgeId;
  const fullSnapshot = entry.forward.find((f) => f.path === '$');
  if (fullSnapshot) {
    if (fullSnapshot.after === null) {
      state.edges.delete(id);
    } else {
      state.edges.set(id, fullSnapshot.after as GovernedEdge);
    }
    return;
  }
  const existing = state.edges.get(id);
  if (!existing) return;
  const kindChange = entry.forward.find((f) => f.path === 'kind');
  if (kindChange) {
    state.edges.set(id, { ...existing, kind: kindChange.after as GovernedEdge['kind'] });
  }
}

export function applyDiffEntry(state: ReplayState, entry: NodeLevelDiff): void {
  if (entry.entityKind === 'node') {
    applyNodeDiffEntry(state, entry);
  } else {
    applyEdgeDiffEntry(state, entry);
  }
}

/** Content digest over the fully-replayed state, sorted by id for determinism. */
export function digestReplayState(state: ReplayState): string {
  const nodes = [...state.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...state.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify({ nodes, edges })).digest('hex');
}
