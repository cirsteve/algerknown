import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { GovernanceAuthProvider } from '../../../src/client/auth';
import { ProposalDetail } from '../../../src/client/components/governance/ProposalDetail';
import { useNodeHistory } from '../../../src/client/hooks/useGovernance';
import { acceptedProposalDetail, node1HistoryResponse, PENDING_PROPOSAL_ID } from '../fixtures/proposal';
import { server } from '../mocks/server';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>
        <GovernanceAuthProvider>{children}</GovernanceAuthProvider>
      </MemoryRouter>
    </SWRConfig>
  );
}

describe('conflict recovery: create refresh amendment', () => {
  it('persists an empty-patch amendment via the real amend endpoint, requiring a note', async () => {
    let amendBody: unknown;
    server.use(
      http.get('/api/governance/proposals/:id', () =>
        HttpResponse.json({ ...acceptedProposalDetail(), status: 'pending', version: 1, expectedTargetRevision: 3, currentTargetRevision: 9, conflict: { stale: true } }),
      ),
      http.post('/api/governance/proposals/:id/amend', async ({ request }) => {
        amendBody = await request.json();
        return HttpResponse.json({ id: PENDING_PROPOSAL_ID, version: 2, status: 'pending' });
      }),
    );

    render(<ProposalDetail id={PENDING_PROPOSAL_ID} onDirtyChange={() => {}} />, { wrapper });

    await userEvent.click(await screen.findByRole('button', { name: 'Create refresh amendment' }));
    const submit = screen.getByRole('button', { name: 'Persist refresh amendment' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/Required note/i), 'Acknowledging the namespace moved on.');
    await userEvent.click(submit);

    await waitFor(() => expect(amendBody).toMatchObject({ expectedVersion: 1, patch: [] }));
    expect((amendBody as Record<string, unknown>).idempotencyKey).toBeTruthy();
  });
});

function NodeHistoryProbe({ namespace, nodeId }: { namespace: string; nodeId: string }) {
  const { revisions } = useNodeHistory(namespace, nodeId);
  return <div data-testid="node-history-count">{revisions?.length ?? 'loading'}</div>;
}

describe('revert refreshes node history', () => {
  it('invalidates the cached node-history entry after a successful revert', async () => {
    let historyCallCount = 0;
    server.use(
      http.get('/api/governance/proposals/:id', () => HttpResponse.json(acceptedProposalDetail())),
      http.get('/api/governance/nodes/:id/history', () => {
        historyCallCount += 1;
        return HttpResponse.json(node1HistoryResponse);
      }),
      http.post('/api/governance/proposals/:id/revert', () => HttpResponse.json({ status: 'reverted', newRevision: 9 })),
    );

    render(
      <>
        <NodeHistoryProbe namespace={acceptedProposalDetail().targetNamespace} nodeId="node-1" />
        <ProposalDetail id={PENDING_PROPOSAL_ID} onDirtyChange={() => {}} />
      </>,
      { wrapper },
    );

    await waitFor(() => expect(historyCallCount).toBe(1));

    await userEvent.click(await screen.findByRole('button', { name: 'History' }));
    await userEvent.click(await screen.findByRole('button', { name: /Revert revision/ }));
    await userEvent.type(screen.getByLabelText(/Reason/i), 'This broke downstream consumers.');
    await userEvent.click(screen.getAllByRole('button', { name: 'Revert' }).pop()!);

    await waitFor(() => expect(historyCallCount).toBeGreaterThanOrEqual(2));
  });
});
