import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { GovernanceAuthProvider } from '../../../src/client/auth';
import { ReviewActions } from '../../../src/client/components/governance/ReviewActions';
import { RevertDialog } from '../../../src/client/components/governance/RevertDialog';
import { acceptedProposalDetail, pendingProposalDetail } from '../fixtures/proposal';
import { server } from '../mocks/server';

function wrapper({ children }: { children: ReactNode }) {
  return <GovernanceAuthProvider>{children}</GovernanceAuthProvider>;
}

describe('ReviewActions', () => {
  it('disables Accept until a review note is entered, then submits it', async () => {
    let capturedBody: unknown;
    server.use(
      http.post('/api/governance/proposals/:id/accept', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ status: 'accepted', resultingRevision: 4 });
      }),
    );

    render(<ReviewActions proposal={pendingProposalDetail} onConflict={() => {}} />, { wrapper });

    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    // Two "Accept" buttons now exist: the trigger and the dialog's confirm (the last one, starts disabled).
    const dialogButtons = screen.getAllByRole('button', { name: 'Accept' });
    const dialogConfirm = dialogButtons[dialogButtons.length - 1]!;
    expect(dialogConfirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Review note/i), 'Looks correct, confirmed against source.');
    expect(dialogConfirm).not.toBeDisabled();
    await userEvent.click(dialogConfirm);

    await waitFor(() => expect(capturedBody).toMatchObject({ expectedVersion: 1, expectedTargetRevision: 3, reviewNote: 'Looks correct, confirmed against source.' }));
    expect((capturedBody as Record<string, unknown>).idempotencyKey).toBeTruthy();
    expect(await screen.findByText('Proposal accepted.')).toBeInTheDocument();
  });

  it('surfaces a version conflict by invoking onConflict instead of a generic error', async () => {
    server.use(
      http.post('/api/governance/proposals/:id/accept', () => HttpResponse.json({ error: 'version_conflict', expectedVersion: 1, actualVersion: 2 }, { status: 409 })),
    );
    const onConflict = vi.fn();
    render(<ReviewActions proposal={pendingProposalDetail} onConflict={onConflict} />, { wrapper });

    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await userEvent.type(screen.getByLabelText(/Review note/i), 'Approved.');
    await userEvent.click(screen.getAllByRole('button', { name: 'Accept' }).pop()!);

    await waitFor(() => expect(onConflict).toHaveBeenCalled());
  });

  it('shows no actions for a terminal (accepted) proposal', async () => {
    render(<ReviewActions proposal={acceptedProposalDetail()} onConflict={() => {}} />, { wrapper });
    await waitFor(() => {});
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});

describe('RevertDialog', () => {
  it('requires a reason and reports the new revision on success', async () => {
    server.use(http.post('/api/governance/proposals/:id/revert', () => HttpResponse.json({ status: 'reverted', newRevision: 7 })));
    const onReverted = vi.fn();
    render(<RevertDialog proposalId="prop-1" proposalVersion={2} resultingRevision={4} onReverted={onReverted} />, { wrapper });

    await userEvent.click(screen.getByRole('button', { name: /Revert revision 4/ }));
    const confirm = screen.getByRole('button', { name: 'Revert' });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Reason/i), 'This broke downstream consumers.');
    await userEvent.click(confirm);

    await waitFor(() => expect(onReverted).toHaveBeenCalledWith(7));
  });
});
