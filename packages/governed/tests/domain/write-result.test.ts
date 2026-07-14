import { describe, expect, it } from 'vitest';
import {
  asNamespaceId,
  asProposalId,
  type WriteResult,
} from '../../src/domain/index.js';

function describeOutcome(result: WriteResult): string {
  switch (result.outcome) {
    case 'applied':
      return `applied:${result.resultingRevision}`;
    case 'rejected':
      return `rejected:${result.reasonCodes.join(',')}`;
    case 'routed_to_proposal':
      return `routed:${result.proposalId}`;
    case 'conflict':
      return `conflict:${result.expectedRevision ?? 'null'}->${result.actualRevision}`;
    case 'idempotent_replay':
      return `replay:${describeOutcome(result.original)}`;
  }
}

describe('WriteResult closed union', () => {
  it('narrows exhaustively on outcome', () => {
    const applied: WriteResult = {
      outcome: 'applied',
      previousRevision: null,
      resultingRevision: 1,
      diff: [],
    };
    expect(describeOutcome(applied)).toBe('applied:1');

    const routed: WriteResult = {
      outcome: 'routed_to_proposal',
      proposalId: asProposalId('proposal-1'),
      reasonCodes: ['CONTRADICTION_DETECTED'],
      evaluatorVerdicts: [],
    };
    expect(describeOutcome(routed)).toBe('routed:proposal-1');

    const replay: WriteResult = {
      outcome: 'idempotent_replay',
      original: applied,
    };
    expect(describeOutcome(replay)).toBe('replay:applied:1');
  });

  it('carries a namespace-scoped conflict with both revisions', () => {
    const conflict: WriteResult = {
      outcome: 'conflict',
      reasonCodes: ['STALE_REVISION'],
      expectedRevision: 3,
      actualRevision: 5,
    };
    expect(conflict.actualRevision).toBeGreaterThan(conflict.expectedRevision ?? 0);
    expect(asNamespaceId('canonical.global')).toBe('canonical.global');
  });
});
