import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ragApi, checkRagConnection, type IngestResult } from '../lib/ragApi';
import { api, IndexEntryRef } from '../lib/api';
import { useJob } from '../hooks/useJob';
import { useJobsContext } from '../context/JobsContext';
import { revalidateProposalQueue } from '../hooks/useGovernance';
import type { DurableProposalStatus } from '../lib/governanceApi';
import { GovernanceQueue } from '../components/governance/GovernanceQueue';
import { ProposalFilters } from '../components/governance/ProposalFilters';
import { ProposalDetail } from '../components/governance/ProposalDetail';

type IngestState = 'idle' | 'selecting' | 'ingesting';

const STATUS_PARAM = 'tab';
const NAMESPACE_PARAM = 'namespace';
const PROPOSAL_PARAM = 'proposal';
const CURSOR_PARAM = 'cursor';

function isStatus(value: string | null): value is DurableProposalStatus {
  return value === 'pending' || value === 'accepted' || value === 'rejected' || value === 'expired';
}

/**
 * Ingest & Review: entry selection + compute-only job progress on top, the
 * durable proposal queue and detail underneath. JobStore/job.result never
 * carries proposal content -- only the durable proposal ids and counts a
 * completed ingest job returns are used to focus the just-created records.
 */
export function IngestPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<IngestState>('idle');
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<IndexEntryRef[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [namespaceOptions, setNamespaceOptions] = useState<string[]>([]);
  const [detailDirty, setDetailDirty] = useState(false);

  const { isComplete, isFailed, result, progress, progressDetail, job, error: jobError } = useJob<IngestResult>(currentJobId);
  const { trackJob } = useJobsContext();

  const status = isStatus(searchParams.get(STATUS_PARAM)) ? (searchParams.get(STATUS_PARAM) as DurableProposalStatus) : 'pending';
  const namespace = searchParams.get(NAMESPACE_PARAM) ?? '';
  const selectedProposalId = searchParams.get(PROPOSAL_PARAM);
  const cursor = searchParams.get(CURSOR_PARAM) ?? undefined;

  function updateParams(next: Record<string, string | null>) {
    if (detailDirty && next[PROPOSAL_PARAM] !== undefined && next[PROPOSAL_PARAM] !== selectedProposalId) {
      if (!window.confirm('Discard unsaved amendment edits and switch proposals?')) return;
      setDetailDirty(false);
    }
    setSearchParams(
      (prev) => {
        const merged = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(next)) {
          if (value === null) merged.delete(key);
          else merged.set(key, value);
        }
        return merged;
      },
      { replace: true },
    );
  }

  function focusProposals(proposalIds: string[]) {
    if (proposalIds.length === 0) return;
    updateParams({ [STATUS_PARAM]: 'pending', [PROPOSAL_PARAM]: proposalIds[0]!, [CURSOR_PARAM]: null });
    void revalidateProposalQueue();
  }

  // Resume compute progress from ?job= (e.g. navigating from the Jobs dashboard).
  const resumeJobId = searchParams.get('job');
  useEffect(() => {
    if (!resumeJobId) return;

    ragApi
      .getJob<IngestResult>(resumeJobId)
      .then((resumedJob) => {
        if (resumedJob.status === 'running' || resumedJob.status === 'pending') {
          setCurrentJobId(resumeJobId);
          setState('ingesting');
        } else if (resumedJob.status === 'complete') {
          focusProposals(resumedJob.result?.proposal_ids ?? []);
        } else if (resumedJob.status === 'failed') {
          setError(resumedJob.error || 'Ingest failed');
        }
        updateParams({ job: null });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load job'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeJobId]);

  useEffect(() => {
    checkConnection();
    loadEntries();
  }, [location.key]);

  useEffect(() => {
    if (isComplete && result) {
      focusProposals(result.proposal_ids);
      setState('idle');
      setCurrentJobId(null);
    }
    if (isFailed && job) {
      setError(job.error || 'Ingest failed');
      setState('selecting');
      setCurrentJobId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete, isFailed]);

  useEffect(() => {
    if (jobError && currentJobId) {
      setError(jobError.message || 'Lost connection to job');
      setState('selecting');
      setCurrentJobId(null);
    }
  }, [jobError, currentJobId]);

  const checkConnection = async () => {
    const connResult = await checkRagConnection();
    setRagConnected(connResult.connected);
  };

  const loadEntries = async () => {
    try {
      const allEntries = await api.getEntries();
      setEntries(allEntries.filter((e) => e.type === 'entry'));
    } catch (err) {
      console.error('Failed to load entries:', err);
    }
  };

  const handleIngest = async () => {
    if (!selectedEntry) return;
    setState('ingesting');
    setError(null);
    try {
      const entry = entries.find((e) => e.id === selectedEntry);
      if (!entry) throw new Error('Entry not found');
      const response = await ragApi.ingest(entry.path);
      setCurrentJobId(response.job_id);
      trackJob(response.job_id, 'ingest');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
      setState('selecting');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Ingest &amp; Review</h1>
          <p className="text-sm text-slate-400 mt-1">Generate proposals from an entry, then review and act on the durable proposal queue below.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${ragConnected === null ? 'bg-yellow-500' : ragConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm text-slate-400">{ragConnected === null ? 'Checking RAG...' : ragConnected ? 'RAG Online' : 'RAG Offline'}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 text-red-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-red-100 text-sm">
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-slate-800 rounded-lg p-6">
        <h2 className="text-lg font-medium text-slate-100 mb-4">Generate proposals</h2>
        {state === 'ingesting' ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-sky-500 rounded-full animate-pulse" />
                <div className="w-3 h-3 bg-sky-500 rounded-full animate-pulse delay-75" />
                <div className="w-3 h-3 bg-sky-500 rounded-full animate-pulse delay-150" />
              </div>
              <span className="text-slate-300">{progress || 'Starting...'}</span>
            </div>
            {progressDetail && progressDetail.total_steps > 0 && (
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className="bg-sky-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${(progressDetail.current_step / progressDetail.total_steps) * 100}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <select
              value={selectedEntry || ''}
              onChange={(e) => setSelectedEntry(e.target.value || null)}
              className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-slate-100"
            >
              <option value="">Select an entry...</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                  {entry.last_ingested ? ` (ingested: ${entry.last_ingested})` : ' (never ingested)'}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setState('selecting');
                handleIngest();
              }}
              disabled={!selectedEntry || !ragConnected}
              className="bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap"
            >
              Ingest Entry
            </button>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-medium text-slate-100 mb-4">Durable proposal queue</h2>
        <ProposalFilters
          status={status}
          onStatusChange={(next) => updateParams({ [STATUS_PARAM]: next, [CURSOR_PARAM]: null })}
          namespace={namespace}
          onNamespaceChange={(next) => updateParams({ [NAMESPACE_PARAM]: next || null, [CURSOR_PARAM]: null })}
          namespaceOptions={namespaceOptions}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
          <GovernanceQueue
            status={status}
            namespace={namespace}
            cursor={cursor}
            selectedId={selectedProposalId}
            onSelect={(id) => updateParams({ [PROPOSAL_PARAM]: id })}
            onCursorChange={(next) => updateParams({ [CURSOR_PARAM]: next ?? null })}
            onNamespacesObserved={(observed) =>
              setNamespaceOptions((prev) => Array.from(new Set([...prev, ...observed])).sort())
            }
          />
          <div>
            {selectedProposalId ? (
              <ProposalDetail id={selectedProposalId} onDirtyChange={setDetailDirty} />
            ) : (
              <div className="bg-slate-800 rounded-lg p-6 text-center text-slate-500">Select a proposal to inspect it.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
