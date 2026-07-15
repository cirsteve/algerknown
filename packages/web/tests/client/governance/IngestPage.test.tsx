import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { SWRConfig } from 'swr';
import { GovernanceAuthProvider } from '../../../src/client/auth';
import { JobsProvider } from '../../../src/client/context/JobsContext';
import { IngestPage } from '../../../src/client/pages/IngestPage';
import { pendingProposalDetail } from '../fixtures/proposal';
import { server } from '../mocks/server';

function renderIngestPage(initialEntries: string[] = ['/ingest']) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter initialEntries={initialEntries}>
        <GovernanceAuthProvider>
          <JobsProvider>
            <IngestPage />
          </JobsProvider>
        </GovernanceAuthProvider>
      </MemoryRouter>
    </SWRConfig>,
  );
}

describe('IngestPage', () => {
  it('lists entries, submits an ingest job, and focuses the durable proposal it creates on completion', async () => {
    server.use(
      http.get('/api/entries', () => HttpResponse.json([{ id: 'entry-1', type: 'entry', path: 'entries/entry-1.yaml' }])),
      http.get('/rag/health', () => HttpResponse.json({ status: 'ok', documents_indexed: 1, content_dir: '.' })),
      http.post('/rag/ingest', () => HttpResponse.json({ job_id: 'job-1', status: 'pending' })),
      http.get('/rag/jobs/job-1', () =>
        HttpResponse.json({
          job_id: 'job-1',
          type: 'ingest',
          status: 'complete',
          progress: 'Complete',
          progress_detail: null,
          created_at: 0,
          updated_at: 0,
          error: null,
          trace_id: null,
          result: { entry_id: 'entry-1', proposal_ids: [pendingProposalDetail.id], suppressed: [], counts: { generated: 1, persisted: 1, suppressed: 0 } },
        }),
      ),
    );

    renderIngestPage();

    await screen.findByText('Select an entry...'); // wait for entries to load
    const select = screen.getByDisplayValue('Select an entry...');
    await userEvent.selectOptions(select, 'entry-1');
    await userEvent.click(screen.getByRole('button', { name: 'Ingest Entry' }));

    // Once the job completes, the queue/detail focus on the durable proposal id -- never on job.result content.
    // The subject appears in both the queue card and the now-loaded detail panel.
    await waitFor(async () => expect(await screen.findAllByText(pendingProposalDetail.targetSubject)).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.queryByText(/Generating proposals/)).not.toBeInTheDocument();
  });

  it('restores status/namespace/proposal/cursor filters from the URL', async () => {
    server.use(
      http.get('/api/entries', () => HttpResponse.json([])),
      http.get('/rag/health', () => HttpResponse.json({ status: 'ok', documents_indexed: 0, content_dir: '.' })),
    );

    renderIngestPage([`/ingest?tab=pending&namespace=memory.project.demo&proposal=${pendingProposalDetail.id}`]);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true'));
    // Detail is fetched directly from the `proposal` URL param, independent of the queue's own namespace filter.
    expect(await screen.findAllByText(pendingProposalDetail.targetSubject)).not.toHaveLength(0);
  });

  it('honors a ?tab=deleted deep link instead of silently falling back to pending', async () => {
    let requestedStatus: string | null = null;
    server.use(
      http.get('/api/entries', () => HttpResponse.json([])),
      http.get('/rag/health', () => HttpResponse.json({ status: 'ok', documents_indexed: 0, content_dir: '.' })),
      http.get('/api/governance/proposals', ({ request }) => {
        requestedStatus = new URL(request.url).searchParams.get('status');
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );

    renderIngestPage(['/ingest?tab=deleted']);

    await waitFor(() => expect(requestedStatus).toBe('deleted'));
    expect(await screen.findByText('No deleted proposals')).toBeInTheDocument();
  });
});
