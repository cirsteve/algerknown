import { CANONICAL_ONLY_NODE_TYPES } from '../../domain/node.js';
import type { NodeType } from '../../domain/node.js';
import { CANONICAL_NAMESPACE_CLASS } from '../../config/namespace-policy.js';
import type { NamespacePolicyEntry } from '../../config/namespace-policy.js';
import type { EvaluatorVerdict } from '../../domain/provenance.js';
import { makeVerdict } from './verdict.js';

/**
 * The two non-negotiable structural truth protections. Both are checked
 * against the resolved namespace class/policy, never against a namespace's
 * name, so a misconfigured namespace table cannot weaken them.
 */

export function evaluateTruthTypePlacement(nodeType: NodeType, namespaceEntry: NamespacePolicyEntry): EvaluatorVerdict {
  if (CANONICAL_ONLY_NODE_TYPES.includes(nodeType) && namespaceEntry.class !== CANONICAL_NAMESPACE_CLASS) {
    return makeVerdict('truth-protection', false, ['TRUTH_TYPE_REQUIRES_CANONICAL_NAMESPACE']);
  }
  return makeVerdict('truth-protection', true);
}

/** Blocks any AI-with-rails write path from creating, updating, deleting, reverting, or superseding a truth-type node. */
export function evaluateAiTruthMutationBlock(nodeType: NodeType, namespaceEntry: NamespacePolicyEntry): EvaluatorVerdict {
  if (CANONICAL_ONLY_NODE_TYPES.includes(nodeType) && namespaceEntry.policy === 'ai-with-rails') {
    return makeVerdict('truth-protection', false, ['AI_TRUTH_MUTATION_FORBIDDEN']);
  }
  return makeVerdict('truth-protection', true);
}
