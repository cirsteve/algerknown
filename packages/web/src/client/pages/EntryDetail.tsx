import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, Entry, Link as EntryLink } from '../lib/api';
import { HistoryTab } from '../components/HistoryTab';

type TabType = 'content' | 'history';

export function EntryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('content');

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      try {
        const entryData = await api.getEntry(id);
        setEntry(entryData);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [id]);

  const handleDelete = async () => {
    if (!id || deleteConfirmText !== id) return;
    setDeleting(true);
    try {
      await api.deleteEntry(id);
      navigate('/entries');
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="text-slate-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-500/20 text-red-300 p-4 rounded-lg">
        Error: {error}
      </div>
    );
  }

  if (!entry) {
    return <div className="text-slate-400">Entry not found</div>;
  }

  // Explicit field rendering - no generic loop

  return (
    <div className="space-y-6">
      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
            <h2 className="text-xl font-bold text-red-400">Delete Entry</h2>
            <p className="text-slate-300">
              This action cannot be undone. To confirm, type the entry ID:
            </p>
            <p className="font-mono text-sm bg-slate-900 p-2 rounded text-slate-100">
              {id}
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type entry ID to confirm"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 font-mono text-sm focus:border-red-500 focus:outline-none"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
                className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== id || deleting}
                className="bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link to="/entries" className="text-sky-400 hover:text-sky-300 text-base">
            ← Back to entries
          </Link>
          <h1 className="text-2xl font-bold text-slate-100 mt-2">
            {entry.topic || entry.id}
          </h1>
          {/* Date Display removed from here */}
          <div className="flex items-center gap-4 mt-2 text-lg text-slate-400">
            <span className={`entry-type-badge ${entry.type === 'summary'
              ? 'bg-blue-500/20 text-blue-300'
              : 'bg-green-500/20 text-green-300'
              }`}>
              {entry.type}
            </span>
            <span>{entry.id}</span>
            <span className={`px-2 py-0.5 rounded text-base ${entry.status === 'active' ? 'bg-green-500/20 text-green-300' :
              entry.status === 'archived' ? 'bg-gray-500/20 text-gray-300' :
                'bg-yellow-500/20 text-yellow-300'
              }`}>
              {entry.status}
            </span>
            {/* Date Display */}
            {(entry as any).date_range ? (
              <span>
                {(entry as any).date_range.start} - {(entry as any).date_range.end}
              </span>
            ) : (entry as any).date ? (
              <span>
                {(entry as any).date}
              </span>
            ) : null}
            {/* Time Display */}
            {(entry as any).time_hours ? (
              <span className="text-slate-500 text-base">
                • {(entry as any).time_hours}h
              </span>
            ) : null}
            {/* Last Ingested Display */}
            {(entry as any).last_ingested ? (
              <span className="text-slate-500 text-base" title="Last Ingested">
                • Ingested: {(entry as any).last_ingested}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/entries/${id}/edit`}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm"
          >
            Edit
          </Link>
          <Link
            to={`/graph/${id}`}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm"
          >
            View Graph
          </Link>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="bg-red-600/20 hover:bg-red-600/40 text-red-400 px-4 py-2 rounded-lg text-sm"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Tags */}
      {entry.tags && entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entry.tags.map(tag => (
            <span key={tag} className="text-sm px-2 py-1 bg-slate-700 rounded text-slate-300">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        <button
          onClick={() => setActiveTab('content')}
          className={`px-4 py-2 text-base font-medium transition-colors ${activeTab === 'content'
            ? 'text-sky-400 border-b-2 border-sky-400'
            : 'text-slate-400 hover:text-slate-200'
            }`}
        >
          Content
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 text-base font-medium transition-colors ${activeTab === 'history'
            ? 'text-sky-400 border-b-2 border-sky-400'
            : 'text-slate-400 hover:text-slate-200'
            }`}
        >
          History
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'content' ? (
        <>
          {/* Content */}
          {/* Summary (for Summaries) */}
          {entry.summary && (
            <div className="bg-slate-800 rounded-lg p-6 space-y-4">
              <h2 className="text-xl font-semibold text-slate-200">Summary</h2>
              <p className="text-lg text-slate-100 whitespace-pre-wrap">{entry.summary}</p>
            </div>
          )}

          {/* Context (for Entries) */}
          {entry.context && (
            <div className="bg-slate-800 rounded-lg p-6 space-y-4">
              <h2 className="text-xl font-semibold text-slate-200">Context</h2>
              <p className="text-lg text-slate-100 whitespace-pre-wrap">{entry.context}</p>
            </div>
          )}

          {/* Approach */}
          {(entry as any).approach && (
            <div className="bg-slate-800 rounded-lg p-6 space-y-4">
              <h2 className="text-xl font-semibold text-slate-200">Approach</h2>
              <p className="text-lg text-slate-100 whitespace-pre-wrap">{(entry as any).approach}</p>
            </div>
          )}

          {/* Outcome */}
          {(entry as any).outcome && (
            <div className="bg-slate-800 rounded-lg p-6 space-y-6">
              <h2 className="text-xl font-semibold text-slate-200">Outcome</h2>

              {/* Worked */}
              {(entry as any).outcome.worked && (entry as any).outcome.worked.length > 0 && (
                <div>
                  <h3 className="text-lg font-medium text-green-400 mb-2">What Worked</h3>
                  <ul className="list-disc list-inside space-y-1">
                    {(entry as any).outcome.worked.map((item: string, idx: number) => (
                      <li key={idx} className="text-lg text-slate-100">{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Failed */}
              {(entry as any).outcome.failed && (entry as any).outcome.failed.length > 0 && (
                <div>
                  <h3 className="text-lg font-medium text-red-400 mb-2">What Failed</h3>
                  <ul className="list-disc list-inside space-y-1">
                    {(entry as any).outcome.failed.map((item: string, idx: number) => (
                      <li key={idx} className="text-lg text-slate-100">{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Surprised */}
              {(entry as any).outcome.surprised && (entry as any).outcome.surprised.length > 0 && (
                <div>
                  <h3 className="text-lg font-medium text-purple-400 mb-2">Surprises</h3>
                  <ul className="list-disc list-inside space-y-1">
                    {(entry as any).outcome.surprised.map((item: string, idx: number) => (
                      <li key={idx} className="text-lg text-slate-100">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Learnings */}
          {(entry as any).learnings && (entry as any).learnings.length > 0 && (
            <div className="bg-slate-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-indigo-200 mb-4">Learnings</h2>
              <div className="space-y-4">
                {(entry as any).learnings.map((learning: any, idx: number) => (
                  <div key={idx} className="bg-slate-900/30 rounded-lg p-4 space-y-2 border border-slate-700/50">
                    <p className="text-lg text-slate-100 font-medium">{learning.insight}</p>
                    {learning.context && (
                      <p className="text-base text-slate-400 italic">Context: {learning.context}</p>
                    )}
                    {learning.relevance && learning.relevance.length > 0 && (
                      <div className="flex gap-2 items-center flex-wrap">
                        <span className="text-xs uppercase tracking-wide text-slate-500">Relevance:</span>
                        {learning.relevance.map((relId: string) => (
                          <Link key={relId} to={`/entries/${relId}`} className="text-sm text-indigo-400 hover:text-indigo-300 hover:underline">
                            {relId}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Decisions */}
          {(entry as any).decisions && (entry as any).decisions.length > 0 && (
            <div className="bg-slate-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-teal-200 mb-4">Decisions</h2>
              <div className="space-y-6">
                {(entry as any).decisions.map((decision: any, idx: number) => (
                  <div key={idx} className="bg-slate-900/50 rounded-lg p-4 space-y-3 border border-slate-700">
                    <div className="flex justify-between items-start gap-4">
                      <h3 className="text-lg font-medium text-slate-100">{decision.decision}</h3>
                      {decision.date && (
                        <span className="text-sm font-mono text-slate-500 whitespace-nowrap">{decision.date}</span>
                      )}
                    </div>

                    {decision.superseded_by && (
                      <div className="bg-red-500/10 text-red-300 text-sm px-3 py-1.5 rounded inline-block">
                        Superseded by: <Link to={`/entries/${decision.superseded_by}`} className="underline hover:text-red-200">{decision.superseded_by}</Link>
                      </div>
                    )}

                    {decision.rationale && (
                      <div>
                        <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Rationale</div>
                        <p className="text-base text-slate-300">{decision.rationale}</p>
                      </div>
                    )}

                    {decision.trade_offs && (
                      <div>
                        <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Trade-offs</div>
                        <p className="text-base text-slate-300">{decision.trade_offs}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open Questions */}
          {(entry as any).open_questions && (entry as any).open_questions.length > 0 && (
            <div className="bg-slate-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-amber-200 mb-4">Open Questions</h2>
              <ul className="list-disc list-inside space-y-2">
                {(entry as any).open_questions.map((question: string, idx: number) => (
                  <li key={idx} className="text-lg text-slate-200">{question}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Resources */}
          {(entry as any).resources && (entry as any).resources.length > 0 && (
            <div className="bg-slate-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-slate-200 mb-4">Resources</h2>
              <div className="space-y-3">
                {(entry as any).resources.map((resource: any, idx: number) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:text-sky-300 text-lg hover:underline"
                    >
                      {resource.title || resource.url}
                    </a>
                    {resource.notes && (
                      <span className="text-base text-slate-500">{resource.notes}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Artifacts */}
          {(entry as any).artifacts && (entry as any).artifacts.length > 0 && (
            <div className="bg-slate-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-slate-200 mb-4">Artifacts</h2>
              <div className="space-y-4">
                {(entry as any).artifacts.map((artifact: any, idx: number) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg text-slate-100 font-mono break-all">{artifact.path}</span>
                      {artifact.repo && (
                        <span className="text-sm text-slate-400 bg-slate-700 px-2 py-0.5 rounded">{artifact.repo}</span>
                      )}
                    </div>
                    {artifact.commit && (
                      <div className="text-sm font-mono text-slate-500">
                        Commit: {artifact.commit}
                      </div>
                    )}
                    {artifact.notes && (
                      <span className="text-base text-slate-400">{artifact.notes}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commits */}
          {(entry as any).commits && (entry as any).commits.length > 0 && (
            <div className="bg-slate-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-slate-200 mb-4">Commits</h2>
              <ul className="list-disc list-inside space-y-1">
                {(entry as any).commits.map((commit: string, idx: number) => (
                  <li key={idx} className="text-lg font-mono text-slate-300">
                    {commit}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Open Questions moved from here */}

          {/* Links */}
          {entry.links && entry.links.length > 0 && (
            <div className="bg-slate-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-slate-200 mb-4">Links</h2>
              <div className="space-y-3">
                {entry.links.map((link: EntryLink, idx: number) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="text-sm px-2 py-1 bg-slate-700 rounded text-slate-400">
                      {link.relationship.replace(/_/g, ' ')}
                    </span>
                    <Link
                      to={`/entries/${link.id}`}
                      className="text-sky-400 hover:text-sky-300 text-lg" // Added text-lg
                    >
                      {link.id}
                    </Link>
                    {link.notes && (
                      <span className="text-base text-slate-500">— {link.notes}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <HistoryTab entryId={id!} />
      )}
    </div>
  );
}
