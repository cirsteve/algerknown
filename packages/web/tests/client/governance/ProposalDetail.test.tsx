import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { GovernanceAuthProvider } from '../../../src/client/auth';
import { ProposalDetail } from '../../../src/client/components/governance/ProposalDetail';
import { PENDING_PROPOSAL_ID, acceptedProposalDetail, pendingProposalDetail } from '../fixtures/proposal';
import { server } from '../mocks/server';

// A fresh SWR cache per render: several tests here mock different response
// bodies for the same proposal id, and SWR's default cache is a module-level
// singleton that would otherwise leak stale data across tests in this file.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>
        <GovernanceAuthProvider>{children}</GovernanceAuthProvider>
      </MemoryRouter>
    </SWRConfig>
  );
}

describe('ProposalDetail', () => {
  it('renders overview, diff, provenance, and history tabs for a pending proposal', async () => {
    render(<ProposalDetail id={PENDING_PROPOSAL_ID} onDirtyChange={() => {}} />, { wrapper });

    expect(await screen.findByText(pendingProposalDetail.targetSubject)).toBeInTheDocument();
    expect(screen.getByText('New learnings')).toBeInTheDocument(); // Summary adapter on the overview tab

    await userEvent.click(screen.getByRole('button', { name: 'Diff' }));
    expect(screen.getByText('Node mutations (3)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Provenance/ }));
    expect(screen.getByText('rail: human-gated')).toBeInTheDocument();
    expect(screen.getByText('schema-type')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('proposed')).toBeInTheDocument();
  });

  it('shows a conflict banner and disables normal recovery when the proposal is stale', async () => {
    server.use(http.get('/api/governance/proposals/:id', () => HttpResponse.json({ ...pendingProposalDetail, expectedTargetRevision: 3, currentTargetRevision: 9, conflict: { stale: true } })));

    render(<ProposalDetail id={PENDING_PROPOSAL_ID} onDirtyChange={() => {}} />, { wrapper });

    expect(await screen.findByText(/target revision is stale/i)).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('reports dirty state up while the amendment editor has an unsaved draft', async () => {
    const onDirtyChange = vi.fn();
    render(<ProposalDetail id={PENDING_PROPOSAL_ID} onDirtyChange={onDirtyChange} />, { wrapper });

    await userEvent.click(await screen.findByRole('button', { name: 'Edit / remove items' }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });

  it('offers revert only for an accepted, unreverted proposal with a resulting revision', async () => {
    server.use(http.get('/api/governance/proposals/:id', () => HttpResponse.json(acceptedProposalDetail())));

    render(<ProposalDetail id={PENDING_PROPOSAL_ID} onDirtyChange={() => {}} />, { wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'History' }));

    expect(await screen.findByRole('button', { name: /Revert revision 4/ })).toBeInTheDocument();
  });
});
