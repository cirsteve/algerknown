import type { NodeId } from '../../domain/ids.js';
import type { GovernedNode } from '../../domain/node.js';
import type { ContradictionCandidate, ContradictionDetector } from '../../ports/contradiction-detector.js';
import type { EvaluatorVerdict } from '../../domain/provenance.js';
import { makeVerdict } from './verdict.js';

export interface ContradictionCheckResult {
  verdict: EvaluatorVerdict;
  contradictingNodeIds: NodeId[];
}

/**
 * Never trusts caller-supplied contradiction findings: always calls the
 * composition-root-owned ContradictionDetector itself, loads each returned
 * node, and only treats it as a real contradiction if its confidence is
 * strictly higher than the candidate's.
 */
export async function evaluateContradictions(
  detector: ContradictionDetector,
  candidate: ContradictionCandidate,
  resolveNode: (id: NodeId) => Promise<GovernedNode | undefined>,
): Promise<ContradictionCheckResult> {
  const matches = await detector.findContradictions(candidate);
  const contradictingNodeIds: NodeId[] = [];

  for (const match of matches) {
    const existing = await resolveNode(match.nodeId);
    if (existing && existing.confidence > candidate.candidateNode.confidence) {
      contradictingNodeIds.push(match.nodeId);
    }
  }

  if (contradictingNodeIds.length > 0) {
    return {
      verdict: makeVerdict('contradiction', false, ['CONTRADICTION_DETECTED'], { contradictingNodeIds }),
      contradictingNodeIds,
    };
  }

  return { verdict: makeVerdict('contradiction', true), contradictingNodeIds: [] };
}
