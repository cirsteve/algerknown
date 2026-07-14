import type { ContradictionCandidate, ContradictionDetector, ContradictionMatch } from '../../src/index.js';

/** Test double: returns whatever matches were configured, regardless of the candidate -- the orchestrator still re-checks confidence itself. */
export class ConfigurableContradictionDetector implements ContradictionDetector {
  private matches: ContradictionMatch[] = [];

  setMatches(matches: ContradictionMatch[]): void {
    this.matches = matches;
  }

  async findContradictions(_candidate: ContradictionCandidate): Promise<ContradictionMatch[]> {
    return this.matches;
  }
}
