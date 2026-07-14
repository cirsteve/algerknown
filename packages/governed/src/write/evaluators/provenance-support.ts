import type { NodeId } from '../../domain/ids.js';
import type { WriteCommand } from '../../domain/write-command.js';
import type { GovernedNode } from '../../domain/node.js';
import type { EvaluatorVerdict } from '../../domain/provenance.js';
import { makeVerdict } from './verdict.js';

export function evaluateProvenanceCompleteness(command: WriteCommand): EvaluatorVerdict {
  if (command.provenanceInput.sources.length === 0) {
    return makeVerdict('provenance-support', false, ['PROVENANCE_MISSING_SOURCE']);
  }
  return makeVerdict('provenance-support', true);
}

/** A candidate explicitly marked source-derived must carry a derived_from edge to an existing source in this command. */
export function evaluateDerivedFromRequirement(command: WriteCommand): EvaluatorVerdict {
  if (!command.provenanceInput.sourceDerived) {
    return makeVerdict('provenance-support', true);
  }
  const hasDerivedFromEdge = command.edgeMutations.some((m) => m.op === 'create' && m.kind === 'derived_from');
  if (!hasDerivedFromEdge) {
    return makeVerdict('provenance-support', false, ['PROVENANCE_MISSING_DERIVED_FROM_EDGE']);
  }
  return makeVerdict('provenance-support', true);
}

/**
 * Every proposal must reference at least one existing observation via a
 * derived_from or evidence_for edge, making unsupported proposals
 * structurally unreviewable rather than merely low quality.
 */
export function evaluateProposalObservationSupport(
  supportingObservationIds: NodeId[],
  resolveNode: (id: NodeId) => GovernedNode | undefined,
): EvaluatorVerdict {
  if (supportingObservationIds.length === 0) {
    return makeVerdict('provenance-support', false, ['PROPOSAL_MISSING_OBSERVATION_SUPPORT']);
  }
  for (const id of supportingObservationIds) {
    const node = resolveNode(id);
    if (!node || node.type !== 'observation') {
      return makeVerdict('provenance-support', false, ['PROPOSAL_MISSING_OBSERVATION_SUPPORT']);
    }
  }
  return makeVerdict('provenance-support', true);
}

export function evaluateProposalSupportEdge(command: WriteCommand): EvaluatorVerdict {
  const hasSupportEdge = command.edgeMutations.some(
    (m) => m.op === 'create' && (m.kind === 'derived_from' || m.kind === 'evidence_for'),
  );
  if (!hasSupportEdge) {
    return makeVerdict('provenance-support', false, ['PROPOSAL_MISSING_SUPPORT_EDGE']);
  }
  return makeVerdict('provenance-support', true);
}
