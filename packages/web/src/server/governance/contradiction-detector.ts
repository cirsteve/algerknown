import type { ContradictionDetector, ContradictionMatch } from '@algerknown/governed';

/**
 * No contradiction-detection model is in scope for this cohort; every
 * candidate is treated as non-contradicting so writes proceed through the
 * remaining rails instead of being silently routed to a proposal by a rule
 * this cohort never implemented.
 */
export function createNoOpContradictionDetector(): ContradictionDetector {
  return {
    async findContradictions(): Promise<ContradictionMatch[]> {
      return [];
    },
  };
}
