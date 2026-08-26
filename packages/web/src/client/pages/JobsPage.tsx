import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { JobResponse } from '../hooks/useJob';
import { JOB_STATUS_COLORS, JOB_TYPE_COLORS } from '../lib/designTokens';
import { formatDuration, formatRelativeTime } from '../lib/format';

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
    return r.json();
  });

type StatusFilter = 'all' | 'running' | 'complete' | 'failed';

/*
 * The jobs table keeps real columns rather than reflowing to cards - status,
 * duration and age only read as a table - so below `min-w` it scrolls inside its
 * own bordered region while the page stays inside the viewport.
 */
const JOBS_TABLE_MIN_WIDTH = 'min-w-[44rem]';
const cell = 'px-3 py-3 sm:px-4';

function Badge({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function hasProposals(job: JobResponse): boolean {
  const result = job.result as Record<string, unknown> | null;
  return Array.isArray(result?.proposals) && result.proposals.length > 0;
}

function JobRow({ job }: { job: JobResponse }) {
  const [expanded, setExpanded] = useState(false);
  const duration = job.updated_at - job.created_at;
  const isActive = job.status === 'pending' || job.status === 'running';

  return (
    <>
      {/*
       * The row stays a row. `<tr>` admits only `role="row"`, so giving it the
       * button role would take the job out of the table for a screen reader; the
       * disclosure lives on a real <button> in the first cell instead, which is
       * what carries the keyboard contract and `aria-expanded`. The row keeps its
       * click handler purely as a larger mouse target.
       */}
      <tr
        className="cursor-pointer border-b border-edge transition-colors hover:bg-surface-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <td className={cell}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`Details for ${job.type} job ${job.job_id}`}
            onClick={(event) => {
              event.stopPropagation(); // the row would otherwise toggle it back
              setExpanded(!expanded);
            }}
            className="flex items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden="true" className="text-xs text-content-subtle">
              {expanded ? '▼' : '▶'}
            </span>
            <Badge label={job.type} className={JOB_TYPE_COLORS[job.type] || ''} />
          </button>
        </td>
        <td className={cell}>
          <Badge label={job.status} className={JOB_STATUS_COLORS[job.status] || ''} />
        </td>
        <td className={`${cell} text-sm text-content`}>
          <div className="flex items-center gap-2">
            {isActive && (
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
            )}
            <span className="break-words">{job.progress}</span>
          </div>
        </td>
        <td className={`${cell} font-mono text-sm text-content-muted`}>
          {formatDuration(duration * 1000)}
        </td>
        <td className={`${cell} whitespace-nowrap text-sm text-content-subtle`}>
          {formatRelativeTime(job.created_at)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className={`bg-surface-sunken ${cell}`}>
            <div className="space-y-3 text-sm">
              {/* The three metadata facts only fit one row from `sm`. */}
              <div className="flex flex-col gap-1 text-xs text-content-subtle sm:flex-row sm:flex-wrap sm:gap-6">
                <span className="break-all">Job ID: <code className="text-content-muted">{job.job_id}</code></span>
                <span>Created: {new Date(job.created_at * 1000).toLocaleString()}</span>
                <span>Updated: {new Date(job.updated_at * 1000).toLocaleString()}</span>
              </div>

              <div className="flex flex-wrap gap-4">
                {job.trace_id && (
                  <Link
                    to={`/traces?highlight=${job.trace_id}`}
                    className="rounded-sm text-sm text-link transition-colors hover:text-link-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={e => e.stopPropagation()}
                  >
                    View Trace &rarr;
                  </Link>
                )}
                {job.type === 'ingest' && (
                  job.status === 'pending' ||
                  job.status === 'running' ||
                  (job.status === 'complete' && hasProposals(job))
                ) && (
                  <Link
                    to={`/ingest?job=${job.job_id}`}
                    className="rounded-sm text-sm text-amber-700 transition-colors hover:text-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-amber-400 dark:hover:text-amber-300"
                    onClick={e => e.stopPropagation()}
                  >
                    {job.status === 'complete' ? 'Review Proposals' : 'Resume Ingest'} &rarr;
                  </Link>
                )}
              </div>

              {job.error && (
                <div className="rounded border border-red-300 bg-red-50 p-3 dark:border-red-700 dark:bg-red-900/30">
                  <div className="mb-1 text-xs font-medium text-red-700 dark:text-red-400">Error</div>
                  <div className="break-words text-red-900 dark:text-red-300">{job.error}</div>
                </div>
              )}

              {job.result != null && (
                <div>
                  <div className="mb-1 text-xs font-medium text-content-subtle">Result</div>
                  <pre className="max-h-48 overflow-auto rounded border border-edge bg-surface-raised p-3 font-mono text-xs text-content">
                    {JSON.stringify(job.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function JobsPage() {
  const [filter, setFilter] = useState<StatusFilter>('all');

  const { data, error, isLoading } = useSWR<{ jobs: JobResponse[]; total: number }>(
    '/rag/jobs?limit=100',
    fetcher,
    {
      refreshInterval: (latestData) => {
        if (!latestData) return 2000;
        const hasActive = latestData.jobs.some(
          j => j.status === 'pending' || j.status === 'running'
        );
        return hasActive ? 2000 : 10000;
      },
      revalidateOnFocus: false,
    },
  );

  const jobs = data?.jobs ?? [];
  const filtered = filter === 'all'
    ? jobs
    : filter === 'running'
      ? jobs.filter(j => j.status === 'pending' || j.status === 'running')
      : jobs.filter(j => j.status === filter);
  const runningCount = jobs.filter(j => j.status === 'running' || j.status === 'pending').length;
  const completedCount = jobs.filter(j => j.status === 'complete').length;
  const failedCount = jobs.filter(j => j.status === 'failed').length;

  const filters: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: jobs.length },
    { key: 'running', label: 'Running', count: runningCount },
    { key: 'complete', label: 'Completed', count: completedCount },
    { key: 'failed', label: 'Failed', count: failedCount },
  ];

  const statCard = 'min-w-0 rounded-lg border border-edge bg-surface-raised p-4';

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-content-strong sm:text-2xl">Jobs</h1>
        <p className="mt-1 text-sm text-content-muted">
          Monitor background query and ingest jobs
        </p>
      </div>

      {/* Stats - three tiles do not fit 320px, so the third wraps below. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className={statCard}>
          <div className="mb-1 text-xs text-content-subtle">Running</div>
          <div className="text-2xl font-bold text-sky-700 dark:text-sky-400">{runningCount}</div>
        </div>
        <div className={statCard}>
          <div className="mb-1 text-xs text-content-subtle">Completed</div>
          <div className="text-2xl font-bold text-green-700 dark:text-green-400">{completedCount}</div>
        </div>
        <div className={statCard}>
          <div className="mb-1 text-xs text-content-subtle">Failed</div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-400">{failedCount}</div>
        </div>
      </div>

      {/* Filter tabs - four labelled counts are wider than 320px, so the strip
          scrolls inside itself instead of the page. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex w-max gap-1 rounded-lg bg-surface-raised p-1">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`whitespace-nowrap rounded-md px-4 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                filter === f.key
                  ? 'bg-control text-content'
                  : 'text-content-muted hover:bg-surface-hover hover:text-content'
              }`}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </div>

      {/* Jobs table */}
      {isLoading ? (
        <div className="text-sm text-content-muted">Loading jobs...</div>
      ) : error ? (
        <div className="break-words text-sm text-red-700 dark:text-red-400">Failed to load jobs: {error.message}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-edge bg-surface-raised p-6 text-center text-content-muted sm:p-8">
          {jobs.length === 0
            ? 'No jobs yet. Submit a query or ingest to get started.'
            : 'No jobs match the current filter.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-edge">
          <table className={`w-full ${JOBS_TABLE_MIN_WIDTH}`}>
            <thead className="border-b border-edge bg-surface-hover text-xs text-content-muted">
              <tr>
                <th className={`${cell} py-2 text-left`}>Type</th>
                <th className={`${cell} py-2 text-left`}>Status</th>
                <th className={`${cell} py-2 text-left`}>Progress</th>
                <th className={`${cell} py-2 text-left`}>Duration</th>
                <th className={`${cell} py-2 text-left`}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(job => (
                <JobRow key={job.job_id} job={job} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
