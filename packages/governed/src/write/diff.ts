import { isDeepStrictEqual } from 'node:util';
import type { EdgeId, NodeId } from '../domain/ids.js';
import type { GovernedEdge } from '../domain/edge.js';
import type { GovernedNode } from '../domain/node.js';
import type { DiffChangeKind, FieldChange, NodeLevelDiff } from '../domain/revision.js';

function deepEqual(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

function diffPayloadFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): { forward: FieldChange[]; inverse: FieldChange[] } {
  const forward: FieldChange[] = [];
  const inverse: FieldChange[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    const beforeValue = before?.[key] ?? null;
    const afterValue = after?.[key] ?? null;
    if (!deepEqual(beforeValue, afterValue)) {
      forward.push({ path: `payload.${key}`, before: beforeValue, after: afterValue });
      inverse.push({ path: `payload.${key}`, before: afterValue, after: beforeValue });
    }
  }
  return { forward, inverse };
}

export function buildNodeDiff(
  nodeId: NodeId,
  changeKind: DiffChangeKind,
  before: GovernedNode | undefined,
  after: GovernedNode | undefined,
): NodeLevelDiff {
  if (before === undefined && after !== undefined) {
    return {
      entityKind: 'node',
      entityId: nodeId,
      changeKind,
      forward: [{ path: '$', before: null, after }],
      inverse: [{ path: '$', before: after, after: null }],
    };
  }
  if (before !== undefined && after === undefined) {
    return {
      entityKind: 'node',
      entityId: nodeId,
      changeKind,
      forward: [{ path: '$', before, after: null }],
      inverse: [{ path: '$', before: null, after: before }],
    };
  }
  if (before !== undefined && after !== undefined) {
    const { forward, inverse } = diffPayloadFields(
      before.payload as unknown as Record<string, unknown>,
      after.payload as unknown as Record<string, unknown>,
    );
    if (before.confidence !== after.confidence) {
      forward.push({ path: 'confidence', before: before.confidence, after: after.confidence });
      inverse.push({ path: 'confidence', before: after.confidence, after: before.confidence });
    }
    return { entityKind: 'node', entityId: nodeId, changeKind, forward, inverse };
  }
  return { entityKind: 'node', entityId: nodeId, changeKind, forward: [], inverse: [] };
}

export function buildEdgeDiff(
  edgeId: EdgeId,
  changeKind: DiffChangeKind,
  before: GovernedEdge | undefined,
  after: GovernedEdge | undefined,
): NodeLevelDiff {
  if (before === undefined && after !== undefined) {
    return {
      entityKind: 'edge',
      entityId: edgeId,
      changeKind,
      forward: [{ path: '$', before: null, after }],
      inverse: [{ path: '$', before: after, after: null }],
    };
  }
  if (before !== undefined && after === undefined) {
    return {
      entityKind: 'edge',
      entityId: edgeId,
      changeKind,
      forward: [{ path: '$', before, after: null }],
      inverse: [{ path: '$', before: null, after: before }],
    };
  }
  if (before !== undefined && after !== undefined && before.kind !== after.kind) {
    return {
      entityKind: 'edge',
      entityId: edgeId,
      changeKind,
      forward: [{ path: 'kind', before: before.kind, after: after.kind }],
      inverse: [{ path: 'kind', before: after.kind, after: before.kind }],
    };
  }
  return { entityKind: 'edge', entityId: edgeId, changeKind, forward: [], inverse: [] };
}

function invertChangeKind(kind: DiffChangeKind): DiffChangeKind {
  if (kind === 'create') return 'delete';
  if (kind === 'delete') return 'create';
  return kind;
}

/** Swaps forward/inverse and change kind so a revert can be applied as a fresh attributable revision. */
export function invertDiff(diff: NodeLevelDiff[]): NodeLevelDiff[] {
  return diff.map((entry) => ({
    entityKind: entry.entityKind,
    entityId: entry.entityId,
    changeKind: invertChangeKind(entry.changeKind),
    forward: entry.inverse,
    inverse: entry.forward,
  }));
}
