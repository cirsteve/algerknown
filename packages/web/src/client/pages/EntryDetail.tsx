import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, Entry, Link as EntryLink } from '../lib/api';
import { HistoryTab } from '../components/HistoryTab';
import { Badge, TypeBadge } from '../components/atoms/Badge';
import { AlertBox } from '../components/molecules/AlertBox';
import { ConfirmDialog } from '../components/molecules/ConfirmDialog';
import { Tab, TabBar } from '../components/molecules/TabBar';

type TabType = 'content' | 'history';

/*
 * Every section is a card on the page surface. `min-w-0` is what stops a long
 * artifact path or a wide code fragment inside one from stretching the column
 * and taking the whole document past the viewport at 320px.
 */
const card = 'min-w-0 rounded-lg border border-edge bg-surface-raised p-4 sm:p-6';

/* Section headings keep their hue as the semantic - a darker shade carries it
 * on white, a lighter one on the dark surface. */
const headings = {
  worked: 'text-green-700 dark:text-green-400',
  failed: 'text-red-700 dark:text-red-400',
  surprised: 'text-purple-700 dark:text-purple-400',
  learnings: 'text-indigo-800 dark:text-indigo-200',
  decisions: 'text-teal-800 dark:text-teal-200',
  questions: 'text-amber-800 dark:text-amber-200',
};

const headerAction =
  'rounded-lg bg-control px-4 py-2 text-sm text-content transition-colors hover:bg-control-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

function statusVariant(status?: string) {
  if (status === 'active') return 'success' as const;
  if (status === 'archived') return 'default' as const;
  return 'warning' as const;
}

export function EntryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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

  // ConfirmDialog owns the "type the id to confirm" gate, so by the time it
  // calls back the text has already matched.
  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await api.deleteEntry(id);
      navigate('/entries');
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
      setShowDeleteModal(false);
    }
  };

  if (loading) {
    return <div className="text-content-muted">Loading...</div>;
  }

  if (error) {
    return (
      <AlertBox variant="error">
        <span className="block break-words">Error: {error}</span>
      </AlertBox>
    );
  }

  if (!entry) {
    return <div className="text-content-muted">Entry not found</div>;
  }

  return (
    <div className="min-w-0 space-y-6">
      <ConfirmDialog
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Entry"
        message="This action cannot be undone. To confirm, type the entry ID:"
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        loading={deleting}
        confirmText={id}
      />

      {/* Header - the meta strip and the action group each wrap on their own so
          neither pushes the other out of the viewport. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <Link
            to="/entries"
            className="rounded-sm text-base text-link transition-colors hover:text-link-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ← Back to entries
          </Link>
          <h1 className="mt-2 break-words text-xl font-bold text-content-strong sm:text-2xl">
            {entry.topic || entry.id}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-content-muted">
            <TypeBadge type={entry.type} />
            <span className="break-all">{entry.id}</span>
            <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
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
              <span className="text-content-subtle">
                • {(entry as any).time_hours}h
              </span>
            ) : null}
            {/* Last Ingested Display */}
            {(entry as any).last_ingested ? (
              <span className="text-content-subtle" title="Last Ingested">
                • Ingested: {(entry as any).last_ingested}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          <Link to={`/entries/${id}/edit`} className={headerAction}>
            Edit
          </Link>
          <Link to={`/graph/${id}`} className={headerAction}>
            View Graph
          </Link>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="rounded-lg bg-red-100 px-4 py-2 text-sm text-red-800 transition-colors hover:bg-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface dark:bg-red-600/20 dark:text-red-300 dark:hover:bg-red-600/40"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Tags */}
      {entry.tags && entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entry.tags.map(tag => (
            <span key={tag} className="rounded bg-control px-2 py-1 text-sm text-content">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <TabBar>
        <Tab active={activeTab === 'content'} onClick={() => setActiveTab('content')}>
          Content
        </Tab>
        <Tab active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
          History
        </Tab>
      </TabBar>

      {/* Tab Content */}
      {activeTab === 'content' ? (
        <>
          {/* Summary (for Summaries) */}
          {entry.summary && (
            <div className={`${card} space-y-4`}>
              <h2 className="text-lg font-semibold text-content-strong sm:text-xl">Summary</h2>
              <p className="whitespace-pre-wrap break-words text-content">{entry.summary}</p>
            </div>
          )}

          {/* Context (for Entries) */}
          {entry.context && (
            <div className={`${card} space-y-4`}>
              <h2 className="text-lg font-semibold text-content-strong sm:text-xl">Context</h2>
              <p className="whitespace-pre-wrap break-words text-content">{entry.context}</p>
            </div>
          )}

          {/* Approach */}
          {(entry as any).approach && (
            <div className={`${card} space-y-4`}>
              <h2 className="text-lg font-semibold text-content-strong sm:text-xl">Approach</h2>
              <p className="whitespace-pre-wrap break-words text-content">{(entry as any).approach}</p>
            </div>
          )}

          {/* Outcome */}
          {(entry as any).outcome && (
            <div className={`${card} space-y-6`}>
              <h2 className="text-lg font-semibold text-content-strong sm:text-xl">Outcome</h2>

              {/* Worked */}
              {(entry as any).outcome.worked && (entry as any).outcome.worked.length > 0 && (
                <div>
                  <h3 className={`mb-2 font-medium ${headings.worked}`}>What Worked</h3>
                  <ul className="list-inside list-disc space-y-1">
                    {(entry as any).outcome.worked.map((item: string, idx: number) => (
                      <li key={idx} className="break-words text-content">{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Failed */}
              {(entry as any).outcome.failed && (entry as any).outcome.failed.length > 0 && (
                <div>
                  <h3 className={`mb-2 font-medium ${headings.failed}`}>What Failed</h3>
                  <ul className="list-inside list-disc space-y-1">
                    {(entry as any).outcome.failed.map((item: string, idx: number) => (
                      <li key={idx} className="break-words text-content">{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Surprised */}
              {(entry as any).outcome.surprised && (entry as any).outcome.surprised.length > 0 && (
                <div>
                  <h3 className={`mb-2 font-medium ${headings.surprised}`}>Surprises</h3>
                  <ul className="list-inside list-disc space-y-1">
                    {(entry as any).outcome.surprised.map((item: string, idx: number) => (
                      <li key={idx} className="break-words text-content">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Learnings */}
          {(entry as any).learnings && (entry as any).learnings.length > 0 && (
            <div className={card}>
              <h2 className={`mb-4 text-lg font-semibold sm:text-xl ${headings.learnings}`}>Learnings</h2>
              <div className="space-y-4">
                {(entry as any).learnings.map((learning: any, idx: number) => (
                  <div key={idx} className="min-w-0 space-y-2 rounded-lg border border-edge bg-surface-sunken p-4">
                    <p className="break-words font-medium text-content">{learning.insight}</p>
                    {learning.context && (
                      <p className="break-words italic text-content-muted">Context: {learning.context}</p>
                    )}
                    {learning.relevance && learning.relevance.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wide text-content-subtle">Relevance:</span>
                        {learning.relevance.map((relId: string) => (
                          <Link
                            key={relId}
                            to={`/entries/${relId}`}
                            className="break-all rounded-sm text-sm text-indigo-700 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-indigo-400 dark:hover:text-indigo-300"
                          >
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
            <div className={card}>
              <h2 className={`mb-4 text-lg font-semibold sm:text-xl ${headings.decisions}`}>Decisions</h2>
              <div className="space-y-6">
                {(entry as any).decisions.map((decision: any, idx: number) => (
                  <div key={idx} className="min-w-0 space-y-3 rounded-lg border border-edge bg-surface-sunken p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <h3 className="min-w-0 break-words font-medium text-content">{decision.decision}</h3>
                      {decision.date && (
                        <span className="font-mono text-sm text-content-subtle sm:whitespace-nowrap">{decision.date}</span>
                      )}
                    </div>

                    {decision.superseded_by && (
                      <div className="inline-block rounded bg-red-100 px-3 py-1.5 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
                        Superseded by:{' '}
                        <Link
                          to={`/entries/${decision.superseded_by}`}
                          className="break-all rounded-sm underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          {decision.superseded_by}
                        </Link>
                      </div>
                    )}

                    {decision.rationale && (
                      <div>
                        <div className="mb-1 text-xs uppercase tracking-wider text-content-subtle">Rationale</div>
                        <p className="break-words text-content-muted">{decision.rationale}</p>
                      </div>
                    )}

                    {decision.trade_offs && (
                      <div>
                        <div className="mb-1 text-xs uppercase tracking-wider text-content-subtle">Trade-offs</div>
                        <p className="break-words text-content-muted">{decision.trade_offs}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open Questions */}
          {(entry as any).open_questions && (entry as any).open_questions.length > 0 && (
            <div className={card}>
              <h2 className={`mb-4 text-lg font-semibold sm:text-xl ${headings.questions}`}>Open Questions</h2>
              <ul className="list-inside list-disc space-y-2">
                {(entry as any).open_questions.map((question: string, idx: number) => (
                  <li key={idx} className="break-words text-content">{question}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Resources */}
          {(entry as any).resources && (entry as any).resources.length > 0 && (
            <div className={card}>
              <h2 className="mb-4 text-lg font-semibold text-content-strong sm:text-xl">Resources</h2>
              <div className="space-y-3">
                {(entry as any).resources.map((resource: any, idx: number) => (
                  <div key={idx} className="flex min-w-0 flex-col gap-1">
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all rounded-sm text-link transition-colors hover:text-link-hover hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {resource.title || resource.url}
                    </a>
                    {resource.notes && (
                      <span className="break-words text-content-subtle">{resource.notes}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Artifacts */}
          {(entry as any).artifacts && (entry as any).artifacts.length > 0 && (
            <div className={card}>
              <h2 className="mb-4 text-lg font-semibold text-content-strong sm:text-xl">Artifacts</h2>
              <div className="space-y-4">
                {(entry as any).artifacts.map((artifact: any, idx: number) => (
                  <div key={idx} className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-mono text-content">{artifact.path}</span>
                      {artifact.repo && (
                        <span className="rounded bg-control px-2 py-0.5 text-sm text-content-muted">{artifact.repo}</span>
                      )}
                    </div>
                    {artifact.commit && (
                      <div className="break-all font-mono text-sm text-content-subtle">
                        Commit: {artifact.commit}
                      </div>
                    )}
                    {artifact.notes && (
                      <span className="break-words text-content-muted">{artifact.notes}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commits */}
          {(entry as any).commits && (entry as any).commits.length > 0 && (
            <div className={card}>
              <h2 className="mb-4 text-lg font-semibold text-content-strong sm:text-xl">Commits</h2>
              <ul className="list-inside list-disc space-y-1">
                {(entry as any).commits.map((commit: string, idx: number) => (
                  <li key={idx} className="break-all font-mono text-content-muted">
                    {commit}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Links */}
          {entry.links && entry.links.length > 0 && (
            <div className={card}>
              <h2 className="mb-4 text-lg font-semibold text-content-strong sm:text-xl">Links</h2>
              <div className="space-y-3">
                {entry.links.map((link: EntryLink, idx: number) => (
                  <div key={idx} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="rounded bg-control px-2 py-1 text-sm text-content">
                      {link.relationship.replace(/_/g, ' ')}
                    </span>
                    <Link
                      to={`/entries/${link.id}`}
                      className="break-all rounded-sm text-link transition-colors hover:text-link-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {link.id}
                    </Link>
                    {link.notes && (
                      <span className="w-full break-words text-content-subtle sm:w-auto">— {link.notes}</span>
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
