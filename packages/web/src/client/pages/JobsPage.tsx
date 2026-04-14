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
      <tr
        className="border-b border-slate-700 hover:bg-slate-800/50 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {expanded ? '\u25BC' : '\u25B6'}
            </span>
            <Badge label={job.type} className={JOB_TYPE_COLORS[job.type] || ''} />
          </div>
        </td>
        <td className="px-4 py-3">
          <Badge label={job.status} className={JOB_STATUS_COLORS[job.status] || ''} />
        </td>
        <td className="px-4 py-3 text-sm text-slate-300">
          <div className="flex items-center gap-2">
            {isActive && (
              <span className="w-2 h-2 bg-sky-500 rounded-full animate-pulse" />
            )}
            {job.progress}
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-slate-400 font-mono">
          {formatDuration(duration * 1000)}
        </td>
        <td className="px-4 py-3 text-sm text-slate-500">
          {formatRelativeTime(job.created_at)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-4 py-3 bg-slate-900/50">
            <div className="space-y-3 text-sm">
              <div className="flex gap-6 text-xs text-slate-500">
                <span>Job ID: <code className="text-slate-400">{job.job_id}</code></span>
                <span>Created: {new Date(job.created_at * 1000).toLocaleString()}</span>
                <span>Updated: {new Date(job.updated_at * 1000).toLocaleString()}</span>
              </div>

              <div className="flex gap-4">
                {job.trace_id && (
                  <Link
                    to={`/traces?highlight=${job.trace_id}`}
                    className="text-sky-400 hover:text-sky-300 text-sm"
                    onClick={e => e.stopPropagation()}
                  >
                    View Trace &rarr;
                  </Link>
                )}
                {job.type === 'ingest' && job.status === 'complete' && hasProposals(job) && (
                  <Link
                    to={`/ingest?job=${job.job_id}`}
                    className="text-amber-400 hover:text-amber-300 text-sm"
                    onClick={e => e.stopPropagation()}
                  >
                    Review Proposals &rarr;
                  </Link>
                )}
              </div>

              {job.error && (
                <div className="bg-red-900/30 border border-red-700 rounded p-3">
                  <div className="text-xs font-medium text-red-400 mb-1">Error</div>
                  <div className="text-red-300">{job.error}</div>
                </div>
              )}

              {job.result != null && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Result</div>
                  <pre className="max-h-48 overflow-auto rounded bg-slate-800 p-3 font-mono text-xs text-slate-300">
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Jobs</h1>
        <p className="text-sm text-slate-400 mt-1">
          Monitor background query and ingest jobs
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-xs text-slate-500 mb-1">Running</div>
          <div className="text-2xl font-bold text-sky-400">{runningCount}</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-xs text-slate-500 mb-1">Completed</div>
          <div className="text-2xl font-bold text-green-400">{completedCount}</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-xs text-slate-500 mb-1">Failed</div>
          <div className="text-2xl font-bold text-red-400">{failedCount}</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 w-fit">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
              filter === f.key
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Jobs table */}
      {isLoading ? (
        <div className="text-sm text-slate-400">Loading jobs...</div>
      ) : error ? (
        <div className="text-sm text-red-400">Failed to load jobs: {error.message}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-800 rounded-lg p-8 text-center text-slate-500">
          {jobs.length === 0
            ? 'No jobs yet. Submit a query or ingest to get started.'
            : 'No jobs match the current filter.'}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-800 text-xs text-slate-500 border-b border-slate-700">
              <tr>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Progress</th>
                <th className="px-4 py-2 text-left">Duration</th>
                <th className="px-4 py-2 text-left">Created</th>
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
