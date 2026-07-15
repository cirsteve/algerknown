import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { GovernanceAuthProvider } from '../../../src/client/auth';
import { GovernanceQueue } from '../../../src/client/components/governance/GovernanceQueue';
import { ProposalFilters } from '../../../src/client/components/governance/ProposalFilters';
import { PENDING_PROPOSAL_ID, pendingProposalDetail } from '../fixtures/proposal';

function wrapper({ children }: { children: ReactNode }) {
  return <GovernanceAuthProvider>{children}</GovernanceAuthProvider>;
}

describe('GovernanceQueue', () => {
  it('renders the pending proposal and reports its namespace, and selecting calls onSelect', async () => {
    const onSelect = vi.fn();
    const onNamespacesObserved = vi.fn();
    render(
      <GovernanceQueue
        status="pending"
        namespace=""
        cursor={undefined}
        selectedId={null}
        onSelect={onSelect}
        onCursorChange={() => {}}
        onNamespacesObserved={onNamespacesObserved}
      />,
      { wrapper },
    );

    const card = await screen.findByText(pendingProposalDetail.targetSubject);
    await waitFor(() => expect(onNamespacesObserved).toHaveBeenCalledWith([pendingProposalDetail.targetNamespace]));

    await userEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(PENDING_PROPOSAL_ID);
  });

  it('shows an empty state for a status with no proposals', async () => {
    render(
      <GovernanceQueue status="accepted" namespace="" cursor={undefined} selectedId={null} onSelect={() => {}} onCursorChange={() => {}} onNamespacesObserved={() => {}} />,
      { wrapper },
    );

    expect(await screen.findByText(/No accepted proposals/i)).toBeInTheDocument();
  });
});

describe('ProposalFilters', () => {
  it('calls onStatusChange and onNamespaceChange', async () => {
    const onStatusChange = vi.fn();
    const onNamespaceChange = vi.fn();
    render(
      <ProposalFilters status="pending" onStatusChange={onStatusChange} namespace="" onNamespaceChange={onNamespaceChange} namespaceOptions={['memory.project.demo']} />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Accepted' }));
    expect(onStatusChange).toHaveBeenCalledWith('accepted');

    await userEvent.selectOptions(screen.getByLabelText('Namespace:'), 'memory.project.demo');
    expect(onNamespaceChange).toHaveBeenCalledWith('memory.project.demo');
  });
});
