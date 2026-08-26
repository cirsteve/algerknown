import { useState, useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ragApi, ProposalData, checkRagConnection, type IngestResult } from '../lib/ragApi';
import { api, IndexEntryRef } from '../lib/api';
import { useJob } from '../hooks/useJob';
import { useJobsContext } from '../context/JobsContext';
import { StatusIndicator } from '../components/atoms/StatusIndicator';
import { AlertBox } from '../components/molecules/AlertBox';

type IngestState = 'idle' | 'selecting' | 'ingesting' | 'reviewing' | 'applying';

const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

const panel = 'min-w-0 rounded-lg border border-edge bg-surface-raised p-4 sm:p-6';

const smallButton = `rounded px-3 py-1 text-sm font-medium transition-colors ${focusRing}`;
const neutralButton = `rounded-lg bg-control px-4 py-2 text-sm text-content transition-colors hover:bg-control-hover ${focusRing}`;

/* Proposal edit rows are sunken panels inside an already-raised card, so the
   fields themselves take the raised surface to lift back off that row. */
const editField =
  'w-full rounded border border-edge bg-surface-raised px-2 py-1 text-content transition-colors placeholder:text-content-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40';

const removeButton = `shrink-0 rounded px-2 text-sm text-red-700 transition-colors hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 ${focusRing}`;

export function IngestPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<IngestState>('idle');
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<IndexEntryRef[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalData[]>([]);
  const [approvedProposals, setApprovedProposals] = useState<Set<number>>(new Set());
  const [editingProposal, setEditingProposal] = useState<number | null>(null);
  const [editedProposals, setEditedProposals] = useState<Map<number, ProposalData>>(new Map());
  const [applyResults, setApplyResults] = useState<Array<{ proposal: ProposalData; success: boolean; error?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const { isComplete, isFailed, result, progress, progressDetail, job, error: jobError } = useJob<IngestResult>(currentJobId);
  const { trackJob } = useJobsContext();

  // Resume proposal review from ?job= param (e.g. navigating from Jobs dashboard)
  const resumeJobId = searchParams.get('job');
  useEffect(() => {
    if (!resumeJobId) return;

    ragApi.getJob<IngestResult>(resumeJobId)
      .then(job => {
        if (job.status === 'complete' && job.result?.proposals?.length) {
          setProposals(job.result.proposals as ProposalData[]);
          setState('reviewing');
        } else if (job.status === 'running' || job.status === 'pending') {
          setCurrentJobId(resumeJobId);
          setState('ingesting');
        } else if (job.status === 'failed') {
          setError(job.error || 'Ingest failed');
        } else {
          setError('Job has no proposals to review');
        }
        // Clear param only after successful rehydration
        setSearchParams({}, { replace: true });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load job'));
  }, [resumeJobId]);

  // Refetch entries every time page is loaded/navigated to
  useEffect(() => {
    checkConnection();
    loadEntries();
  }, [location.key]);

  // Handle ingest job completion
  useEffect(() => {
    if (isComplete && result) {
      setProposals(result.proposals as ProposalData[]);
      setState('reviewing');
      setCurrentJobId(null);
    }
    if (isFailed && job) {
      setError(job.error || 'Ingest failed');
      setState('selecting');
      setCurrentJobId(null);
    }
  }, [isComplete, isFailed]);

  // Handle polling/network errors (job expired, backend down)
  useEffect(() => {
    if (jobError && currentJobId) {
      setError(jobError.message || 'Lost connection to job');
      setState('selecting');
      setCurrentJobId(null);
    }
  }, [jobError]);

  const checkConnection = async () => {
    const connResult = await checkRagConnection();
    setRagConnected(connResult.connected);
  };

  const loadEntries = async () => {
    try {
      const allEntries = await api.getEntries();
      setEntries(allEntries.filter(e => e.type === 'entry'));
    } catch (err) {
      console.error('Failed to load entries:', err);
    }
  };

  const handleIngest = async () => {
    if (!selectedEntry) return;

    setState('ingesting');
    setError(null);

    try {
      const entry = entries.find(e => e.id === selectedEntry);
      if (!entry) throw new Error('Entry not found');

      const response = await ragApi.ingest(entry.path);
      setCurrentJobId(response.job_id);
      trackJob(response.job_id, 'ingest');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
      setState('selecting');
    }
  };

  const toggleProposal = (index: number) => {
    setApprovedProposals(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const getProposalData = (index: number): ProposalData => {
    return editedProposals.get(index) ?? proposals[index];
  };

  const startEditing = (index: number) => {
    if (!editedProposals.has(index)) {
      setEditedProposals(prev => new Map(prev).set(index, JSON.parse(JSON.stringify(proposals[index]))));
    }
    setEditingProposal(index);
  };

  const cancelEditing = () => {
    if (editingProposal !== null) {
      setEditedProposals(prev => {
        const next = new Map(prev);
        next.delete(editingProposal);
        return next;
      });
    }
    setEditingProposal(null);
  };

  const saveEditing = () => {
    setEditingProposal(null);
  };

  const updateProposal = (index: number, updates: Partial<ProposalData>) => {
    setEditedProposals(prev => {
      const current = prev.get(index) ?? JSON.parse(JSON.stringify(proposals[index]));
      return new Map(prev).set(index, { ...current, ...updates });
    });
  };

  const handleApplyApproved = async () => {
    if (approvedProposals.size === 0) return;

    setState('applying');
    setLoading(true);
    setApplyResults([]);

    const results: typeof applyResults = [];

    for (const index of Array.from(approvedProposals).sort()) {
      const proposal = getProposalData(index);
      try {
        const response = await ragApi.approve(proposal);
        results.push({
          proposal,
          success: response.success,
          error: response.error,
        });
      } catch (err) {
        results.push({
          proposal,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    setApplyResults(results);
    setLoading(false);
  };

  const handleReset = () => {
    setState('idle');
    setSelectedEntry(null);
    setProposals([]);
    setApprovedProposals(new Set());
    setEditingProposal(null);
    setEditedProposals(new Map());
    setApplyResults([]);
    setError(null);
    setCurrentJobId(null);
    loadEntries();
  };

  const renderProposal = (_proposal: ProposalData, index: number) => {
    const isApproved = approvedProposals.has(index);
    const isEditing = editingProposal === index;
    const displayData = getProposalData(index);
    const hasEdits = editedProposals.has(index);

    const updateLearning = (learningIndex: number, field: 'insight' | 'context', value: string) => {
      const current = getProposalData(index);
      const learnings = [...(current.new_learnings || [])];
      learnings[learningIndex] = { ...learnings[learningIndex], [field]: value };
      updateProposal(index, { new_learnings: learnings });
    };

    const removeLearning = (learningIndex: number) => {
      const current = getProposalData(index);
      const learnings = [...(current.new_learnings || [])];
      learnings.splice(learningIndex, 1);
      updateProposal(index, { new_learnings: learnings });
    };

    const updateDecision = (decisionIndex: number, field: 'decision' | 'rationale', value: string) => {
      const current = getProposalData(index);
      const decisions = [...(current.new_decisions || [])];
      decisions[decisionIndex] = { ...decisions[decisionIndex], [field]: value };
      updateProposal(index, { new_decisions: decisions });
    };

    const removeDecision = (decisionIndex: number) => {
      const current = getProposalData(index);
      const decisions = [...(current.new_decisions || [])];
      decisions.splice(decisionIndex, 1);
      updateProposal(index, { new_decisions: decisions });
    };

    const updateQuestion = (questionIndex: number, value: string) => {
      const current = getProposalData(index);
      const questions = [...(current.new_open_questions || [])];
      questions[questionIndex] = value;
      updateProposal(index, { new_open_questions: questions });
    };

    const removeQuestion = (questionIndex: number) => {
      const current = getProposalData(index);
      const questions = [...(current.new_open_questions || [])];
      questions.splice(questionIndex, 1);
      updateProposal(index, { new_open_questions: questions });
    };

    const updateLink = (linkIndex: number, field: 'id' | 'relationship', value: string) => {
      const current = getProposalData(index);
      const links = [...(current.new_links || [])];
      links[linkIndex] = { ...links[linkIndex], [field]: value };
      updateProposal(index, { new_links: links });
    };

    const removeLink = (linkIndex: number) => {
      const current = getProposalData(index);
      const links = [...(current.new_links || [])];
      links.splice(linkIndex, 1);
      updateProposal(index, { new_links: links });
    };

    return (
      <div
        key={index}
        className={`min-w-0 rounded-lg border p-4 transition-colors ${
          isApproved
            ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
            : isEditing
            ? 'border-accent bg-sky-50 dark:bg-sky-900/20'
            : 'border-edge bg-surface-raised'
        }`}
      >
        {/* Target id and the Edit/Approve pair only share a row from `sm`;
            below that the buttons move under the id rather than clipping it. */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Link
              to={`/entries/${displayData.target_summary_id}`}
              className={`break-all font-medium text-link transition-colors hover:text-link-hover ${focusRing}`}
            >
              {displayData.target_summary_id}
            </Link>
            <div className="mt-1 break-words text-xs text-content-subtle">
              Match: {((displayData.match_score || 0) * 100).toFixed(0)}% ({displayData.match_reason})
              {hasEdits && <span className="ml-2 text-amber-700 dark:text-amber-400">(edited)</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            {isEditing ? (
              <>
                <button
                  onClick={saveEditing}
                  className={`${smallButton} bg-accent text-accent-fg hover:bg-accent-hover`}
                >
                  Done
                </button>
                <button
                  onClick={cancelEditing}
                  className={`${smallButton} bg-control text-content hover:bg-control-hover`}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => startEditing(index)}
                  className={`${smallButton} bg-control text-content hover:bg-control-hover`}
                >
                  Edit
                </button>
                <button
                  onClick={() => toggleProposal(index)}
                  aria-pressed={isApproved}
                  className={`${smallButton} ${
                    isApproved
                      ? 'bg-green-700 text-white hover:bg-green-800 dark:hover:bg-green-600'
                      : 'bg-control text-content hover:bg-control-hover'
                  }`}
                >
                  {isApproved ? '✓ Approved' : 'Approve'}
                </button>
              </>
            )}
          </div>
        </div>

        {displayData.rationale && (
          <p className="mb-3 break-words text-sm italic text-content-muted">
            "{displayData.rationale}"
          </p>
        )}

        {displayData.new_learnings && displayData.new_learnings.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-xs font-medium text-content-subtle">New Learnings:</div>
            {displayData.new_learnings.map((learning, i) => (
              <div key={i} className="mb-1 min-w-0 rounded bg-surface-sunken p-2 text-sm">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <textarea
                        value={learning.insight}
                        onChange={e => updateLearning(i, 'insight', e.target.value)}
                        className={`${editField} text-sm`}
                        rows={2}
                      />
                      <button
                        onClick={() => removeLearning(i)}
                        aria-label="Remove learning"
                        className={removeButton}
                      >
                        ✕
                      </button>
                    </div>
                    <input
                      type="text"
                      value={learning.context || ''}
                      onChange={e => updateLearning(i, 'context', e.target.value)}
                      placeholder="Context (optional)"
                      className={`${editField} text-xs`}
                    />
                  </div>
                ) : (
                  <>
                    <div className="break-words text-content">{learning.insight}</div>
                    {learning.context && (
                      <div className="mt-1 break-words text-xs text-content-subtle">{learning.context}</div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {displayData.new_decisions && displayData.new_decisions.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-xs font-medium text-content-subtle">New Decisions:</div>
            {displayData.new_decisions.map((decision, i) => (
              <div key={i} className="mb-1 min-w-0 rounded bg-surface-sunken p-2 text-sm">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <textarea
                        value={decision.decision}
                        onChange={e => updateDecision(i, 'decision', e.target.value)}
                        className={`${editField} text-sm`}
                        rows={2}
                      />
                      <button
                        onClick={() => removeDecision(i)}
                        aria-label="Remove decision"
                        className={removeButton}
                      >
                        ✕
                      </button>
                    </div>
                    <input
                      type="text"
                      value={decision.rationale || ''}
                      onChange={e => updateDecision(i, 'rationale', e.target.value)}
                      placeholder="Rationale (optional)"
                      className={`${editField} text-xs`}
                    />
                  </div>
                ) : (
                  <>
                    <div className="break-words text-content">{decision.decision}</div>
                    {decision.rationale && (
                      <div className="mt-1 break-words text-xs text-content-subtle">{decision.rationale}</div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {displayData.new_open_questions && displayData.new_open_questions.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-xs font-medium text-content-subtle">New Questions:</div>
            {displayData.new_open_questions.map((q, i) => (
              <div key={i} className="mb-1 min-w-0 break-words rounded bg-surface-sunken p-2 text-sm text-content">
                {isEditing ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={q}
                      onChange={e => updateQuestion(i, e.target.value)}
                      className={`${editField} text-sm`}
                    />
                    <button
                      onClick={() => removeQuestion(i)}
                      aria-label="Remove question"
                      className={removeButton}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  q
                )}
              </div>
            ))}
          </div>
        )}

        {displayData.new_links && displayData.new_links.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-content-subtle">New Links:</div>
            {displayData.new_links.map((link, i) => (
              <div key={i} className="min-w-0 break-words text-sm text-content">
                {isEditing ? (
                  <div className="mb-1 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={link.id}
                      onChange={e => updateLink(i, 'id', e.target.value)}
                      placeholder="Link ID"
                      aria-label="Link ID"
                      className={`${editField} text-sm sm:w-1/3`}
                    />
                    <input
                      type="text"
                      value={link.relationship}
                      onChange={e => updateLink(i, 'relationship', e.target.value)}
                      placeholder="Relationship"
                      aria-label="Relationship"
                      className={`${editField} text-sm`}
                    />
                    <button
                      onClick={() => removeLink(i)}
                      aria-label="Remove link"
                      className={removeButton}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <>→ {link.id} ({link.relationship})</>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-w-0 space-y-6">
      {/* Header - the status readout drops under the title at 320px */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-content-strong sm:text-2xl">Ingest</h1>
          <p className="mt-1 text-sm text-content-muted">
            Add new entries and update related summaries
          </p>
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <StatusIndicator
            status={ragConnected === null ? 'unknown' : ragConnected ? 'online' : 'offline'}
          />
          <span className="text-sm text-content-muted">
            {ragConnected === null
              ? 'Checking RAG...'
              : ragConnected
              ? 'RAG Online'
              : 'RAG Offline'}
          </span>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <AlertBox variant="error">
          <span className="block break-words">{error}</span>
        </AlertBox>
      )}

      {/* Step: Select Entry */}
      {(state === 'idle' || state === 'selecting') && (
        <div className={panel}>
          <h2 className="mb-4 text-lg font-medium text-content-strong">
            1. Select an entry to ingest
          </h2>

          <select
            aria-label="Entry to ingest"
            value={selectedEntry || ''}
            onChange={(e) => setSelectedEntry(e.target.value || null)}
            className="mb-4 w-full rounded-lg border border-edge bg-surface-sunken px-4 py-3 text-content transition-colors hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <option value="">Select an entry...</option>
            {entries.map(entry => (
              <option key={entry.id} value={entry.id}>
                {entry.id}{entry.last_ingested ? ` (ingested: ${entry.last_ingested})` : ' (never ingested)'}
              </option>
            ))}
          </select>

          <button
            onClick={() => { setState('selecting'); handleIngest(); }}
            disabled={!selectedEntry || !ragConnected}
            className={`w-full rounded-lg bg-accent px-6 py-3 font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-control disabled:text-content-subtle sm:w-auto ${focusRing}`}
          >
            Ingest Entry
          </button>
        </div>
      )}

      {/* Step: Ingesting (async job in progress) */}
      {state === 'ingesting' && (
        <div className={panel}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 animate-pulse rounded-full bg-accent" />
              <div className="delay-75 h-3 w-3 animate-pulse rounded-full bg-accent" />
              <div className="delay-150 h-3 w-3 animate-pulse rounded-full bg-accent" />
            </div>
            <span className="min-w-0 break-words text-content">
              {progress || 'Starting...'}
            </span>
          </div>
          {progressDetail && progressDetail.total_steps > 0 && (
            <div className="h-2 w-full rounded-full bg-control">
              <div
                className="h-2 rounded-full bg-accent transition-all duration-500"
                style={{ width: `${(progressDetail.current_step / progressDetail.total_steps) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Step: Review Proposals */}
      {state === 'reviewing' && (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="min-w-0 text-lg font-medium text-content-strong">
              2. Review Proposals ({proposals.length} found)
            </h2>
            <div className="flex flex-wrap gap-2 sm:shrink-0">
              <button onClick={handleReset} className={neutralButton}>
                Start Over
              </button>
              <button
                onClick={handleApplyApproved}
                disabled={approvedProposals.size === 0 || loading}
                className={`rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-control disabled:text-content-subtle dark:hover:bg-green-600 ${focusRing}`}
              >
                Apply {approvedProposals.size} Approved
              </button>
            </div>
          </div>

          {proposals.length === 0 ? (
            <div className={`${panel} text-center text-content-muted`}>
              No update proposals generated. The entry may not relate to existing summaries.
            </div>
          ) : (
            <div className="space-y-4">
              {proposals.map((proposal, index) => renderProposal(proposal, index))}
            </div>
          )}
        </div>
      )}

      {/* Step: Applying */}
      {state === 'applying' && loading && (
        <div className={`${panel} text-center`}>
          <div className="mb-4 flex items-center justify-center gap-2">
            <div className="h-3 w-3 animate-pulse rounded-full bg-green-600 dark:bg-green-500" />
            <div className="delay-75 h-3 w-3 animate-pulse rounded-full bg-green-600 dark:bg-green-500" />
            <div className="delay-150 h-3 w-3 animate-pulse rounded-full bg-green-600 dark:bg-green-500" />
          </div>
          <p className="text-content-muted">Applying approved proposals...</p>
        </div>
      )}

      {/* Step: Results */}
      {state === 'applying' && !loading && applyResults.length > 0 && (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-medium text-content-strong">
              3. Results
            </h2>
            <button
              onClick={handleReset}
              className={`rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover sm:shrink-0 ${focusRing}`}
            >
              Ingest Another
            </button>
          </div>

          <div className="space-y-2">
            {applyResults.map((applyResult, index) => (
              <div
                key={index}
                /* Target id and verdict only share a row from `sm`; an error
                   message beside a long id does not fit 320px. */
                className={`flex min-w-0 flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${
                  applyResult.success
                    ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/30'
                    : 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/30'
                }`}
              >
                <div className="min-w-0">
                  <span className="break-all font-medium text-content">
                    {applyResult.proposal.target_summary_id}
                  </span>
                  {applyResult.error && (
                    <span className="ml-2 break-words text-sm text-red-700 dark:text-red-400">
                      {applyResult.error}
                    </span>
                  )}
                </div>
                <span
                  className={`sm:shrink-0 ${
                    applyResult.success
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {applyResult.success ? '✓ Applied' : '✗ Failed'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
