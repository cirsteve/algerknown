import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { GovernanceAuthProvider } from '../../../src/client/auth';
import { ReviewActions } from '../../../src/client/components/governance/ReviewActions';
import { ProposalDetail } from '../../../src/client/components/governance/ProposalDetail';
import { pendingProposalDetail } from '../fixtures/proposal';
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

describe('idempotent retry', () => {
  it('resubmitting an unchanged reject reason after a failed attempt reuses the same idempotency key', async () => {
    const keys: string[] = [];
    let callCount = 0;
    server.use(
      http.post('/api/governance/proposals/:id/reject', async ({ request }) => {
        callCount += 1;
        const body = (await request.json()) as { idempotencyKey: string };
        keys.push(body.idempotencyKey);
        if (callCount === 1) return HttpResponse.json({ error: 'conflict' }, { status: 409 });
        return HttpResponse.json({ id: pendingProposalDetail.id, version: 2, status: 'rejected' });
      }),
    );

    render(<ReviewActions proposal={pendingProposalDetail} onConflict={() => {}} />, { wrapper });

    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await userEvent.type(screen.getByLabelText(/Reason/i), 'Does not apply here.');

    const confirm = screen.getAllByRole('button', { name: 'Reject' }).pop()!;
    await userEvent.click(confirm);
    await waitFor(() => expect(callCount).toBe(1));
    expect(await screen.findByRole('alert')).toHaveTextContent(/conflict/i);

    // Retry with the exact same, unedited reason.
    await userEvent.click(confirm);
    await waitFor(() => expect(callCount).toBe(2));

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('editing the reason before retrying generates a fresh idempotency key', async () => {
    const keys: string[] = [];
    server.use(
      http.post('/api/governance/proposals/:id/reject', async ({ request }) => {
        const body = (await request.json()) as { idempotencyKey: string };
        keys.push(body.idempotencyKey);
        return HttpResponse.json({ error: 'conflict' }, { status: 409 });
      }),
    );

    render(<ReviewActions proposal={pendingProposalDetail} onConflict={() => {}} />, { wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const field = screen.getByLabelText(/Reason/i);
    const confirm = screen.getAllByRole('button', { name: 'Reject' }).pop()!;

    await userEvent.type(field, 'First reason.');
    await userEvent.click(confirm);
    await waitFor(() => expect(keys).toHaveLength(1));

    await userEvent.type(field, ' Amended.');
    await userEvent.click(confirm);
    await waitFor(() => expect(keys).toHaveLength(2));

    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('stale-conflict recovery', () => {
  it('shows the conflict banner, and Reload current re-fetches the proposal', async () => {
    let detailCallCount = 0;
    server.use(
      http.get('/api/governance/proposals/:id', () => {
        detailCallCount += 1;
        const stillStale = detailCallCount < 2;
        return HttpResponse.json({
          ...pendingProposalDetail,
          expectedTargetRevision: 3,
          currentTargetRevision: stillStale ? 9 : 3,
          conflict: { stale: stillStale },
        });
      }),
    );

    render(<ProposalDetail id={pendingProposalDetail.id} onDirtyChange={() => {}} />, { wrapper });

    expect(await screen.findByText(/target revision is stale/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reload current' }));

    await waitFor(() => expect(screen.queryByText(/target revision is stale/i)).not.toBeInTheDocument());
    expect(detailCallCount).toBeGreaterThanOrEqual(2);
  });

  it('accept never auto-replays after a version conflict -- onConflict fires and the dialog closes without a second request', async () => {
    let acceptCalls = 0;
    server.use(
      http.post('/api/governance/proposals/:id/accept', () => {
        acceptCalls += 1;
        return HttpResponse.json({ error: 'version_conflict', expectedVersion: 1, actualVersion: 2 }, { status: 409 });
      }),
    );
    const onConflict = vi.fn();

    render(<ReviewActions proposal={pendingProposalDetail} onConflict={onConflict} />, { wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await userEvent.type(screen.getByLabelText(/Review note/i), 'Approved.');
    await userEvent.click(screen.getAllByRole('button', { name: 'Accept' }).pop()!);

    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(acceptCalls).toBe(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
