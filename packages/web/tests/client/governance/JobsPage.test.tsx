import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { SWRConfig } from 'swr';
import { JobsPage } from '../../../src/client/pages/JobsPage';
import { server } from '../mocks/server';

function renderJobsPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>
        <JobsPage />
      </MemoryRouter>
    </SWRConfig>,
  );
}

describe('JobsPage', () => {
  it('links a completed ingest job to Open durable proposals using its durable proposal id, not job.result content', async () => {
    server.use(
      http.get('/rag/jobs', () =>
        HttpResponse.json({
          jobs: [
            {
              job_id: 'job-done',
              type: 'ingest',
              status: 'complete',
              progress: 'Complete',
              progress_detail: null,
              created_at: 0,
              updated_at: 5,
              error: null,
              trace_id: null,
              result: { entry_id: 'entry-1', proposal_ids: ['prop-42'], suppressed: [], counts: { generated: 1, persisted: 1, suppressed: 0 } },
            },
          ],
          total: 1,
        }),
      ),
    );

    renderJobsPage();
    await userEvent.click(await screen.findByText('Complete'));

    const link = await screen.findByRole('link', { name: /Open durable proposals/ });
    expect(link).toHaveAttribute('href', '/ingest?tab=pending&proposal=prop-42');
    expect(screen.queryByText(/Resume Ingest/)).not.toBeInTheDocument();
  });

  it('links a running ingest job to progress only, not a proposal', async () => {
    server.use(
      http.get('/rag/jobs', () =>
        HttpResponse.json({
          jobs: [
            {
              job_id: 'job-running',
              type: 'ingest',
              status: 'running',
              progress: 'Generating...',
              progress_detail: null,
              created_at: 0,
              updated_at: 0,
              error: null,
              trace_id: null,
              result: null,
            },
          ],
          total: 1,
        }),
      ),
    );

    renderJobsPage();
    await userEvent.click(await screen.findByText('Generating...'));

    const link = await screen.findByRole('link', { name: /View progress/ });
    expect(link).toHaveAttribute('href', '/ingest?job=job-running');
  });

  it('shows no ingest link for a completed job that persisted no proposals', async () => {
    server.use(
      http.get('/rag/jobs', () =>
        HttpResponse.json({
          jobs: [
            {
              job_id: 'job-empty',
              type: 'ingest',
              status: 'complete',
              progress: 'Complete',
              progress_detail: null,
              created_at: 0,
              updated_at: 0,
              error: null,
              trace_id: null,
              result: { entry_id: 'entry-1', proposal_ids: [], suppressed: [], counts: { generated: 0, persisted: 0, suppressed: 0 } },
            },
          ],
          total: 1,
        }),
      ),
    );

    renderJobsPage();
    await userEvent.click(await screen.findAllByText('Complete').then((els) => els[0]!));

    expect(screen.queryByRole('link', { name: /Open durable proposals/ })).not.toBeInTheDocument();
  });
});
