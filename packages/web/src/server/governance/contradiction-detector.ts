import type { ContradictionDetector, ContradictionMatch } from '@algerknown/governed';

/**
 * Production semantic contradiction discovery is explicitly deferred to
 * Phase 3. Phase 2 proves the structural route with injected deterministic
 * detectors, but this composition treats candidates as non-contradicting
 * until a real provider is selected and validated.
 */
export function createNoOpContradictionDetector(): ContradictionDetector {
  return {
    async findContradictions(): Promise<ContradictionMatch[]> {
      return [];
    },
  };
}
