import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { GovernanceAuthProvider } from '../../../src/client/auth';
import { AmendmentEditor } from '../../../src/client/components/governance/AmendmentEditor';
import { pendingProposalDetail } from '../fixtures/proposal';
import { server } from '../mocks/server';

function wrapper({ children }: { children: ReactNode }) {
  return <GovernanceAuthProvider>{children}</GovernanceAuthProvider>;
}

describe('AmendmentEditor', () => {
  it('reports dirty as soon as editing starts, and clean again after discard', async () => {
    const onDirtyChange = vi.fn();
    render(<AmendmentEditor proposal={pendingProposalDetail} onDirtyChange={onDirtyChange} />, { wrapper });

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Edit / remove items' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    vi.restoreAllMocks();
  });

  it('requires a non-empty note before Save is enabled, and computes a remove + replace patch', async () => {
    let capturedBody: unknown;
    server.use(
      http.post('/api/governance/proposals/:id/amend', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ id: pendingProposalDetail.id, version: 2, status: 'pending' });
      }),
    );

    render(<AmendmentEditor proposal={pendingProposalDetail} onDirtyChange={() => {}} />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: 'Edit / remove items' }));

    const saveButton = screen.getByRole('button', { name: 'Save amendment' });
    expect(saveButton).toBeDisabled(); // no edits yet

    // Remove the anchor observation node (index 0), then edit the learning's description.
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await userEvent.click(removeButtons[0]!);

    const descriptionField = screen.getByDisplayValue('The demo pipeline is fast.');
    await userEvent.clear(descriptionField);
    await userEvent.type(descriptionField, 'Edited insight text.');

    expect(saveButton).toBeDisabled(); // still no note

    await userEvent.type(screen.getByLabelText(/Amendment note/i), 'Tightened the wording.');
    expect(saveButton).not.toBeDisabled();
    await userEvent.click(saveButton);

    await waitFor(() => expect(capturedBody).toBeDefined());
    const body = capturedBody as { expectedVersion: number; patch: unknown[]; idempotencyKey: string };
    expect(body.expectedVersion).toBe(1);
    expect(body.idempotencyKey).toBeTruthy();
    expect(body.patch).toEqual(
      expect.arrayContaining([
        { op: 'remove', path: '/nodeMutations/0' },
        { op: 'replace', path: '/nodeMutations/0/payload/description', value: 'Edited insight text.' },
      ]),
    );
    // No "note" field ever leaves the browser -- amend has no such request field.
    expect(body).not.toHaveProperty('note');

    expect(await screen.findByRole('button', { name: 'Edit / remove items' })).toBeInTheDocument();
  });
});
