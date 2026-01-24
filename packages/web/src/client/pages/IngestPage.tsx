import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ragApi, ProposalData, checkRagConnection, EntryListItem } from '../lib/ragApi';

type IngestState = 'idle' | 'selecting' | 'ingesting' | 'reviewing' | 'applying';

export function IngestPage() {
  const location = useLocation();
  const [state, setState] = useState<IngestState>('idle');
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalData[]>([]);
  const [approvedProposals, setApprovedProposals] = useState<Set<number>>(new Set());
  const [applyResults, setApplyResults] = useState<Array<{ proposal: ProposalData; success: boolean; error?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Refetch entries every time page is loaded/navigated to
  useEffect(() => {
    checkConnection();
    loadEntries();
  }, [location.key]);

  const checkConnection = async () => {
    const result = await checkRagConnection();
    setRagConnected(result.connected);
  };

  const loadEntries = async () => {
    try {
      const response = await ragApi.listEntries();
      // Filter to only show entries (not summaries) for ingestion
      setEntries(response.entries.filter(e => e.type === 'entry'));
    } catch (err) {
      console.error('Failed to load entries:', err);
    }
  };

  const handleIngest = async () => {
    if (!selectedEntry) return;

    setState('ingesting');
    setLoading(true);
    setError(null);

    try {
      const entry = entries.find(e => e.id === selectedEntry);
      if (!entry) throw new Error('Entry not found');

      const response = await ragApi.ingest(entry.path);
      setProposals(response.proposals);
      setState('reviewing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
      setState('selecting');
    } finally {
      setLoading(false);
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

  const handleApplyApproved = async () => {
    if (approvedProposals.size === 0) return;

    setState('applying');
    setLoading(true);
    setApplyResults([]);

    const results: typeof applyResults = [];

    for (const index of Array.from(approvedProposals).sort()) {
      const proposal = proposals[index];
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
    setApplyResults([]);
    setError(null);
    loadEntries(); // Reload entries to get updated last_ingested dates
  };

  const renderProposal = (proposal: ProposalData, index: number) => {
    const isApproved = approvedProposals.has(index);

    return (
      <div
        key={index}
        className={`border rounded-lg p-4 transition-colors ${
          isApproved
            ? 'border-green-500 bg-green-900/20'
            : 'border-slate-600 bg-slate-800'
        }`}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <Link
              to={`/entries/${proposal.target_summary_id}`}
              className="font-medium text-sky-400 hover:text-sky-300"
            >
              {proposal.target_summary_id}
            </Link>
            <div className="text-xs text-slate-500 mt-1">
              Match: {((proposal.match_score || 0) * 100).toFixed(0)}% ({proposal.match_reason})
            </div>
          </div>
          <button
            onClick={() => toggleProposal(index)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              isApproved
                ? 'bg-green-600 hover:bg-green-500 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
            }`}
          >
            {isApproved ? '✓ Approved' : 'Approve'}
          </button>
        </div>

        {proposal.rationale && (
          <p className="text-sm text-slate-400 mb-3 italic">
            "{proposal.rationale}"
          </p>
        )}

        {proposal.new_learnings && proposal.new_learnings.length > 0 && (
          <div className="mb-3">
            <div className="text-xs font-medium text-slate-500 mb-1">New Learnings:</div>
            {proposal.new_learnings.map((learning, i) => (
              <div key={i} className="text-sm bg-slate-900/50 rounded p-2 mb-1">
                <div className="text-slate-200">{learning.insight}</div>
                {learning.context && (
                  <div className="text-xs text-slate-500 mt-1">{learning.context}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {proposal.new_decisions && proposal.new_decisions.length > 0 && (
          <div className="mb-3">
            <div className="text-xs font-medium text-slate-500 mb-1">New Decisions:</div>
            {proposal.new_decisions.map((decision, i) => (
              <div key={i} className="text-sm bg-slate-900/50 rounded p-2 mb-1">
                <div className="text-slate-200">{decision.decision}</div>
                {decision.rationale && (
                  <div className="text-xs text-slate-500 mt-1">{decision.rationale}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {proposal.new_open_questions && proposal.new_open_questions.length > 0 && (
          <div className="mb-3">
            <div className="text-xs font-medium text-slate-500 mb-1">New Questions:</div>
            {proposal.new_open_questions.map((q, i) => (
              <div key={i} className="text-sm text-slate-300 bg-slate-900/50 rounded p-2 mb-1">
                {q}
              </div>
            ))}
          </div>
        )}

        {proposal.new_links && proposal.new_links.length > 0 && (
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1">New Links:</div>
            {proposal.new_links.map((link, i) => (
              <div key={i} className="text-sm text-slate-300">
                → {link.id} ({link.relationship})
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Ingest</h1>
          <p className="text-sm text-slate-400 mt-1">
            Add new entries and update related summaries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              ragConnected === null
                ? 'bg-yellow-500'
                : ragConnected
                ? 'bg-green-500'
                : 'bg-red-500'
            }`}
          />
          <span className="text-sm text-slate-400">
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
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 text-red-200">
          {error}
        </div>
      )}

      {/* Step: Select Entry */}
      {(state === 'idle' || state === 'selecting') && (
        <div className="bg-slate-800 rounded-lg p-6">
          <h2 className="text-lg font-medium text-slate-100 mb-4">
            1. Select an entry to ingest
          </h2>
          
          <select
            value={selectedEntry || ''}
            onChange={(e) => setSelectedEntry(e.target.value || null)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 mb-4"
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
            disabled={!selectedEntry || !ragConnected || loading}
            className="bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Processing...' : 'Ingest Entry'}
          </button>
        </div>
      )}

      {/* Step: Ingesting */}
      {state === 'ingesting' && (
        <div className="bg-slate-800 rounded-lg p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-3 h-3 bg-sky-500 rounded-full animate-pulse" />
            <div className="w-3 h-3 bg-sky-500 rounded-full animate-pulse delay-75" />
            <div className="w-3 h-3 bg-sky-500 rounded-full animate-pulse delay-150" />
          </div>
          <p className="text-slate-300">Analyzing entry and generating proposals...</p>
        </div>
      )}

      {/* Step: Review Proposals */}
      {state === 'reviewing' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-slate-100">
              2. Review Proposals ({proposals.length} found)
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
              >
                Start Over
              </button>
              <button
                onClick={handleApplyApproved}
                disabled={approvedProposals.size === 0 || loading}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium"
              >
                Apply {approvedProposals.size} Approved
              </button>
            </div>
          </div>

          {proposals.length === 0 ? (
            <div className="bg-slate-800 rounded-lg p-6 text-center text-slate-400">
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
        <div className="bg-slate-800 rounded-lg p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse delay-75" />
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse delay-150" />
          </div>
          <p className="text-slate-300">Applying approved proposals...</p>
        </div>
      )}

      {/* Step: Results */}
      {state === 'applying' && !loading && applyResults.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-slate-100">
              3. Results
            </h2>
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-sky-500 hover:bg-sky-400 rounded-lg text-sm font-medium"
            >
              Ingest Another
            </button>
          </div>

          <div className="space-y-2">
            {applyResults.map((result, index) => (
              <div
                key={index}
                className={`flex items-center justify-between p-4 rounded-lg ${
                  result.success
                    ? 'bg-green-900/30 border border-green-700'
                    : 'bg-red-900/30 border border-red-700'
                }`}
              >
                <div>
                  <span className="font-medium">
                    {result.proposal.target_summary_id}
                  </span>
                  {result.error && (
                    <span className="text-sm text-red-400 ml-2">
                      {result.error}
                    </span>
                  )}
                </div>
                <span className={result.success ? 'text-green-400' : 'text-red-400'}>
                  {result.success ? '✓ Applied' : '✗ Failed'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
