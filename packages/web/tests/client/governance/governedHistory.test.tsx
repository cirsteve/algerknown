import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { GovernanceAuthProvider } from '../../../src/client/auth';
import { GovernedRevisionItem } from '../../../src/client/components/molecules/ChangeItem';
import { HistoryList } from '../../../src/client/components/organisms/HistoryList';
import { ChangesPage } from '../../../src/client/pages/ChangesPage';
import { acceptedProposalDetail, node1HistoryResponse, PENDING_PROPOSAL_ID } from '../fixtures/proposal';
import { server } from '../mocks/server';

function wrapper(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter initialEntries={initialEntries}>
          <GovernanceAuthProvider>{children}</GovernanceAuthProvider>
        </MemoryRouter>
      </SWRConfig>
    );
  };
}

describe('GovernedRevisionItem', () => {
  it('renders the revision number, actor, per-field diff, and a link to its proposal', () => {
    render(
      <MemoryRouter>
        <GovernedRevisionItem revision={node1HistoryResponse.revisions[0]!} proposalId="prop-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('steve', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/\/payload\/description/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /proposal prop-1/ })).toHaveAttribute('href', '/ingest?tab=accepted&proposal=prop-1');
  });
});

describe('HistoryList governed section', () => {
  it('renders governed revisions above the legacy changelog when namespace/node props are given', async () => {
    server.use(
      http.get('/rag/entries/:id/history', () => HttpResponse.json({ entry_id: 'demo-dossier', changes: [], total: 0 })),
      http.get('/rag/health', () => HttpResponse.json({ status: 'ok', documents_indexed: 0, content_dir: '.' })),
      http.get('/api/governance/proposals', () => HttpResponse.json({ items: [{ ...acceptedProposalDetail(), id: PENDING_PROPOSAL_ID, resultingRevision: 3 }], nextCursor: null })),
    );

    render(<HistoryList entryId="demo-dossier" governedNamespace="memory.project.demo" governedNodeId="node-1" />, { wrapper: wrapper(['/']) });

    expect(await screen.findByText('Governed revisions for node-1')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: /proposal/ })).toHaveAttribute('href', expect.stringContaining(PENDING_PROPOSAL_ID)));
  });
});

describe('ChangesPage governed section', () => {
  it('renders the linked proposal above the legacy changelog when ?proposal= is present', async () => {
    server.use(
      http.get('/rag/health', () => HttpResponse.json({ status: 'ok', documents_indexed: 0, content_dir: '.' })),
      http.get('/rag/changelog', () => HttpResponse.json({ changes: [], total: 0 })),
      http.get('/rag/changelog/stats', () => HttpResponse.json({ total_changes: 0, by_type: { added: 0, modified: 0, removed: 0 }, first_change: null, last_change: null })),
      http.get('/rag/changelog/sources', () => HttpResponse.json({ sources: [] })),
    );

    render(<ChangesPage />, { wrapper: wrapper([`/changes?proposal=${PENDING_PROPOSAL_ID}&revision=4`]) });

    expect(await screen.findByText('Governed revision 4')).toBeInTheDocument();
    expect(await screen.findByText('Recent Changes')).toBeInTheDocument();
  });

  it('renders nothing governed when no ?proposal= is present', async () => {
    server.use(
      http.get('/rag/health', () => HttpResponse.json({ status: 'ok', documents_indexed: 0, content_dir: '.' })),
      http.get('/rag/changelog', () => HttpResponse.json({ changes: [], total: 0 })),
      http.get('/rag/changelog/stats', () => HttpResponse.json({ total_changes: 0, by_type: { added: 0, modified: 0, removed: 0 }, first_change: null, last_change: null })),
      http.get('/rag/changelog/sources', () => HttpResponse.json({ sources: [] })),
    );

    render(<ChangesPage />, { wrapper: wrapper(['/changes']) });
    expect(await screen.findByText('Recent Changes')).toBeInTheDocument();
    expect(screen.queryByText(/Governed revision/)).not.toBeInTheDocument();
  });
});
