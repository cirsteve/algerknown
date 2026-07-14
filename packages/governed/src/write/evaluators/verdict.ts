import type { EvaluatorVerdict } from '../../domain/provenance.js';
import type { ReasonCode } from '../../domain/reason-codes.js';

export function makeVerdict(
  evaluator: string,
  passed: boolean,
  reasonCodes: ReasonCode[] = [],
  detail?: Record<string, unknown>,
): EvaluatorVerdict {
  const verdict: EvaluatorVerdict = { evaluator, passed, reasonCodes };
  if (detail !== undefined) {
    verdict.detail = detail;
  }
  return verdict;
}
