import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { GovernanceAuthProvider } from '../../../src/client/auth';
import { useProposalActions, useProposalDetail, useProposalQueue } from '../../../src/client/hooks/useGovernance';
import { newIdempotencyKey } from '../../../src/client/lib/governanceApi';
import { PENDING_PROPOSAL_ID } from '../fixtures/proposal';

function wrapper({ children }: { children: ReactNode }) {
  return <GovernanceAuthProvider>{children}</GovernanceAuthProvider>;
}

describe('useProposalQueue', () => {
  it('resolves the pending queue once the auth session is established', async () => {
    const { result } = renderHook(() => useProposalQueue({ status: 'pending' }), { wrapper });

    await waitFor(() => expect(result.current.page).not.toBeNull());
    expect(result.current.page?.items).toHaveLength(1);
    expect(result.current.page?.items[0]!.id).toBe(PENDING_PROPOSAL_ID);
  });
});

describe('useProposalDetail', () => {
  it('resolves full proposal detail by id', async () => {
    const { result } = renderHook(() => useProposalDetail(PENDING_PROPOSAL_ID), { wrapper });

    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    expect(result.current.proposal?.canonicalMutation.nodeMutations).toHaveLength(3);
  });
});

describe('useProposalActions', () => {
  it('accept() resolves with the resulting revision', async () => {
    const { result } = renderHook(() => useProposalActions(PENDING_PROPOSAL_ID), { wrapper });

    await waitFor(() => expect(result.current).toBeDefined());
    const outcome = await result.current.accept({
      expectedVersion: 1,
      expectedTargetRevision: 3,
      reviewNote: 'looks correct',
      idempotencyKey: newIdempotencyKey(),
    });
    expect(outcome).toEqual({ status: 'accepted', resultingRevision: 4 });
  });
});
