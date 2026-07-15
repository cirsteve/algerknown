import { CANONICAL_ONLY_NODE_TYPES } from '../../domain/node.js';
import type { NodeType } from '../../domain/node.js';
import { CANONICAL_NAMESPACE_CLASS } from '../../config/namespace-policy.js';
import type { NamespacePolicyEntry } from '../../config/namespace-policy.js';
import type { EvaluatorVerdict } from '../../domain/provenance.js';
import type { PolicyModeCapabilities } from '../../rails/policy-mode.js';
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

/**
 * Blocks any direct-AI write path from creating, updating, deleting,
 * reverting, or superseding a truth-type node. Keyed on the resolved policy
 * mode's `permitsDirectAiMutation` capability rather than the literal
 * 'ai-with-rails' policy id, so a custom policy mode that permits direct AI
 * mutation cannot slip a truth mutation past this "non-negotiable" block.
 */
export function evaluateAiTruthMutationBlock(nodeType: NodeType, policyMode: PolicyModeCapabilities): EvaluatorVerdict {
  if (CANONICAL_ONLY_NODE_TYPES.includes(nodeType) && policyMode.permitsDirectAiMutation) {
    return makeVerdict('truth-protection', false, ['AI_TRUTH_MUTATION_FORBIDDEN']);
  }
  return makeVerdict('truth-protection', true);
}
