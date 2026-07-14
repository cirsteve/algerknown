import type { EdgeId, NamespaceId, NodeId } from '../../domain/ids.js';
import type { NamespacePolicyEntry } from '../../config/namespace-policy.js';
import type { WriteCommand } from '../../domain/write-command.js';
import type { EvaluatorVerdict } from '../../domain/provenance.js';
import { makeVerdict } from './verdict.js';

const NON_APPEND_ONLY_OPS = new Set(['update', 'delete', 'revert']);

/** Step 3: shape and append-only rules, before any state is loaded. */
export function evaluateOperationShape(command: WriteCommand, namespaceEntry: NamespacePolicyEntry): EvaluatorVerdict {
  if (command.nodeMutations.length === 0 && command.edgeMutations.length === 0) {
    return makeVerdict('operation-shape', false, ['INVALID_MUTATION_SHAPE']);
  }

  if (namespaceEntry.appendOnly) {
    const violatesAppendOnly =
      command.nodeMutations.some((m) => NON_APPEND_ONLY_OPS.has(m.op)) ||
      command.edgeMutations.some((m) => NON_APPEND_ONLY_OPS.has(m.op));
    if (violatesAppendOnly) {
      return makeVerdict('operation-shape', false, ['APPEND_ONLY_VIOLATION']);
    }
  }

  return makeVerdict('operation-shape', true);
}

export interface LoadedEntityNamespaces {
  nodeNamespaces: Map<NodeId, NamespaceId>;
  edgeNamespaces: Map<EdgeId, NamespaceId>;
}

/**
 * Step 4 follow-up: every mutation target that already exists must be found,
 * and must live in the command's own namespace (the shared atomicity
 * boundary) -- a command cannot reach into another namespace's entities.
 */
export function evaluateLoadedTargets(command: WriteCommand, loaded: LoadedEntityNamespaces): EvaluatorVerdict {
  for (const mutation of command.nodeMutations) {
    if (mutation.op === 'create') continue;
    const namespace = loaded.nodeNamespaces.get(mutation.nodeId);
    if (namespace === undefined) {
      return makeVerdict('operation-shape', false, ['TARGET_NOT_FOUND']);
    }
    if (namespace !== command.namespace) {
      return makeVerdict('operation-shape', false, ['CROSS_NAMESPACE_COMMAND']);
    }
  }
  for (const mutation of command.edgeMutations) {
    if (mutation.op === 'create') continue;
    const namespace = loaded.edgeNamespaces.get(mutation.edgeId);
    if (namespace === undefined) {
      return makeVerdict('operation-shape', false, ['TARGET_NOT_FOUND']);
    }
    if (namespace !== command.namespace) {
      return makeVerdict('operation-shape', false, ['CROSS_NAMESPACE_COMMAND']);
    }
  }
  return makeVerdict('operation-shape', true);
}
