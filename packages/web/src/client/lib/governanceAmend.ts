import type { EdgeMutation, JsonPatchOp, NodeMutation } from './governanceApi';

/**
 * The editable view of a proposal's canonical mutation: just the two arrays
 * a reviewer can amend. Everything else on WriteCommand (namespace, subject,
 * actor, provenance, idempotency) is server-derived and never redefined by
 * the browser.
 */
export interface EditableMutations {
  nodeMutations: NodeMutation[];
  edgeMutations: EdgeMutation[];
}

function mutationId(item: NodeMutation | EdgeMutation): string {
  return 'nodeId' in item ? item.nodeId : item.edgeId;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray && bIsArray) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  return aKeys.length === bKeys.length && aKeys.every((key) => Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(aRecord[key], bRecord[key]));
}

/**
 * Only 'create' node mutations carry an editable `payload` -- that's the
 * only shape the review UI ever renders inputs for, so it's the de facto
 * allowlist of editable paths (the API does not yet publish an explicit
 * editable-paths contract).
 */
function diffPayloadFields(itemPath: string, before: NodeMutation, after: NodeMutation): JsonPatchOp[] {
  if (before.op !== 'create' || after.op !== 'create') return [];
  const ops: JsonPatchOp[] = [];
  const beforePayload = before.payload;
  const afterPayload = after.payload;
  const keys = new Set([...Object.keys(beforePayload), ...Object.keys(afterPayload)]);
  for (const key of keys) {
    if (!deepEqual(beforePayload[key], afterPayload[key])) {
      ops.push({ op: 'replace', path: `${itemPath}/payload/${key}`, value: afterPayload[key] });
    }
  }
  return ops;
}

function diffArray<T extends NodeMutation | EdgeMutation>(basePath: string, original: T[], draft: T[]): JsonPatchOp[] {
  const draftById = new Map(draft.map((item) => [mutationId(item), item]));
  const removedIndices = original.reduce<number[]>((acc, item, index) => {
    if (!draftById.has(mutationId(item))) acc.push(index);
    return acc;
  }, []);

  // Highest original index first: removing a larger index never shifts a
  // smaller not-yet-removed index, so no index adjustment is needed among
  // the removes themselves.
  const removeOps: JsonPatchOp[] = [...removedIndices].sort((a, b) => b - a).map((index) => ({ op: 'remove', path: `${basePath}/${index}` }));

  const replaceOps: JsonPatchOp[] = [];
  original.forEach((item, index) => {
    if (removedIndices.includes(index)) return;
    const draftItem = draftById.get(mutationId(item));
    if (!draftItem || deepEqual(item, draftItem)) return;
    // Every removal is applied before any replace, so a surviving item's
    // position after all removes = its original index minus how many
    // removed indices sit below it.
    const adjustedIndex = index - removedIndices.filter((removed) => removed < index).length;
    if ('nodeId' in item) {
      replaceOps.push(...diffPayloadFields(`${basePath}/${adjustedIndex}`, item, draftItem as NodeMutation));
    }
  });

  return [...removeOps, ...replaceOps];
}

/** Builds an RFC 6902 patch (remove + payload-field replace only) from a loaded proposal version and its edited draft. */
export function buildAmendmentPatch(original: EditableMutations, draft: EditableMutations): JsonPatchOp[] {
  return [...diffArray('/nodeMutations', original.nodeMutations, draft.nodeMutations), ...diffArray('/edgeMutations', original.edgeMutations, draft.edgeMutations)];
}

export function cloneEditableMutations(input: EditableMutations): EditableMutations {
  return { nodeMutations: JSON.parse(JSON.stringify(input.nodeMutations)), edgeMutations: JSON.parse(JSON.stringify(input.edgeMutations)) };
}

export function removeMutationById(draft: EditableMutations, id: string): EditableMutations {
  return {
    nodeMutations: draft.nodeMutations.filter((m) => !('nodeId' in m && m.nodeId === id)),
    edgeMutations: draft.edgeMutations.filter((m) => !('edgeId' in m && (m.edgeId === id || ('sourceId' in m && (m.sourceId === id || m.targetId === id))))),
  };
}

export function updateNodePayloadField(draft: EditableMutations, nodeId: string, field: string, value: unknown): EditableMutations {
  return {
    ...draft,
    nodeMutations: draft.nodeMutations.map((m) => (m.op === 'create' && m.nodeId === nodeId ? { ...m, payload: { ...m.payload, [field]: value } } : m)),
  };
}
