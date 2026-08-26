import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ragApi, RagSearchResult } from '../lib/ragApi';
import { AlertBox } from '../components/molecules/AlertBox';

type Step = 'create' | 'analyzing' | 'review' | 'saving';

const fieldStyles =
  'w-full rounded-lg border border-edge bg-surface-sunken text-content transition-colors placeholder:text-content-subtle hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 px-3 py-2';

const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export function SummaryNew() {
  const navigate = useNavigate();

  // Form fields
  const [topic, setTopic] = useState('');
  const [summary, setSummary] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [status, setStatus] = useState<string>('active');

  // Analysis state
  const [step, setStep] = useState<Step>('create');
  const [relatedEntries, setRelatedEntries] = useState<RagSearchResult[]>([]);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const slugify = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const id = slugify(topic);
  const isValidId = /^[a-z0-9-]+$/.test(id) && id.length > 0;
  const tags = tagsInput
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  const canSubmit = topic.trim() !== '' && summary.trim() !== '' && isValidId;

  const handleAnalyze = async () => {
    if (!canSubmit) {
      setError('Topic and summary are required, and topic must produce a valid ID (letters, numbers, hyphens)');
      return;
    }

    setStep('analyzing');
    setError(null);
    setLoading(true);

    try {
      // Search for related entries using the summary content
      const searchText = `${topic} ${summary}`;
      const response = await ragApi.search(searchText, 15, 'entry');
      setRelatedEntries(response.results);
      // Auto-select entries with low distance (high relevance)
      const autoSelected = new Set(
        response.results
          .filter(r => r.distance < 0.5)
          .map(r => r.id)
      );
      setSelectedEntries(autoSelected);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setStep('create');
    } finally {
      setLoading(false);
    }
  };

  const toggleEntry = (entryId: string) => {
    setSelectedEntries(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setStep('saving');
    setLoading(true);
    setError(null);

    try {
      const links = Array.from(selectedEntries).map(entryId => ({
        id: entryId,
        relationship: 'informed_by',
        notes: 'Linked during summary creation via relevance analysis',
      }));

      const entry = {
        id,
        type: 'summary' as const,
        topic,
        status,
        tags: tags.length > 0 ? tags : undefined,
        summary,
        links: links.length > 0 ? links : undefined,
      };

      await api.createEntry(entry);
      navigate(`/entries/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save summary');
      setStep('review');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWithoutAnalysis = async () => {
    if (!canSubmit) {
      setError('Topic and summary are required, and topic must produce a valid ID (letters, numbers, hyphens)');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const entry = {
        id,
        type: 'summary' as const,
        topic,
        status,
        tags: tags.length > 0 ? tags : undefined,
        summary,
      };

      await api.createEntry(entry);
      navigate(`/entries/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save summary');
    } finally {
      setLoading(false);
    }
  };

  const relevancePercent = (distance: number) =>
    Math.max(0, Math.round((1 - distance) * 100));

  const relevanceColor = (relevance: number): string =>
    relevance >= 70
      ? 'text-green-700 dark:text-green-400'
      : relevance >= 40
        ? 'text-yellow-700 dark:text-yellow-400'
        : 'text-content-subtle';

  return (
    <div className="min-w-0 space-y-6">
      <h1 className="text-xl font-bold text-content-strong sm:text-2xl">New Summary</h1>

      {error && (
        <AlertBox variant="error">
          <span className="block break-words">{error}</span>
        </AlertBox>
      )}

      {/* Form */}
      {(step === 'create' || step === 'review') && (
        <div className="min-w-0 space-y-4 rounded-lg border border-edge bg-surface-raised p-4 sm:p-6">
          <div>
            <label htmlFor="summary-topic" className="mb-1 block text-sm font-medium text-content-muted">
              Topic *
            </label>
            <input
              id="summary-topic"
              type="text"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. Vector Database Performance Tuning"
              className={fieldStyles}
              disabled={step === 'review'}
            />
            {topic && (
              <p className={`mt-1 break-all text-xs ${isValidId ? 'text-content-subtle' : 'text-red-700 dark:text-red-400'}`}>
                {isValidId ? `ID: ${id}` : 'Topic must contain at least one letter or number'}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="summary-body" className="mb-1 block text-sm font-medium text-content-muted">
              Summary *
            </label>
            <textarea
              id="summary-body"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Write your summary here..."
              rows={8}
              className={fieldStyles}
              disabled={step === 'review'}
            />
          </div>

          {/* Tags and status only fit side by side from `sm` */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="summary-tags" className="mb-1 block text-sm font-medium text-content-muted">
                Tags (comma-separated)
              </label>
              <input
                id="summary-tags"
                type="text"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="e.g. performance, databases, tuning"
                className={fieldStyles}
                disabled={step === 'review'}
              />
            </div>
            <div>
              <label htmlFor="summary-status" className="mb-1 block text-sm font-medium text-content-muted">
                Status
              </label>
              <select
                id="summary-status"
                value={status}
                onChange={e => setStatus(e.target.value)}
                className={fieldStyles}
                disabled={step === 'review'}
              >
                <option value="active">Active</option>
                <option value="planned">Planned</option>
                <option value="reference">Reference</option>
                <option value="archived">Archived</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>

          {step === 'create' && (
            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <button
                onClick={handleAnalyze}
                disabled={!canSubmit || loading}
                className={`rounded-lg bg-accent px-6 py-2 font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-control disabled:text-content-subtle ${focusRing}`}
              >
                Find Related Entries
              </button>
              <button
                onClick={handleSaveWithoutAnalysis}
                disabled={!canSubmit || loading}
                className={`rounded-lg bg-control px-6 py-2 text-content transition-colors hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
              >
                Save Without Analysis
              </button>
            </div>
          )}
        </div>
      )}

      {/* Analyzing */}
      {step === 'analyzing' && (
        <div className="rounded-lg border border-edge bg-surface-raised p-6 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <div className="h-3 w-3 animate-pulse rounded-full bg-accent" />
            <div className="delay-75 h-3 w-3 animate-pulse rounded-full bg-accent" />
            <div className="delay-150 h-3 w-3 animate-pulse rounded-full bg-accent" />
          </div>
          <p className="text-content-muted">Searching for related entries...</p>
        </div>
      )}

      {/* Review related entries */}
      {step === 'review' && (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="min-w-0 text-lg font-medium text-content-strong">
              Related Entries ({relatedEntries.length} found)
            </h2>
            <div className="flex flex-wrap gap-2 sm:shrink-0">
              <button
                onClick={() => { setStep('create'); setRelatedEntries([]); setSelectedEntries(new Set()); }}
                className={`rounded-lg bg-control px-4 py-2 text-sm text-content transition-colors hover:bg-control-hover ${focusRing}`}
              >
                Back to Edit
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className={`rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-control disabled:text-content-subtle dark:hover:bg-green-600 ${focusRing}`}
              >
                {loading ? 'Saving...' : `Save Summary${selectedEntries.size > 0 ? ` with ${selectedEntries.size} Links` : ''}`}
              </button>
            </div>
          </div>

          {relatedEntries.length === 0 ? (
            <div className="rounded-lg border border-edge bg-surface-raised p-6 text-center text-content-muted">
              No related entries found. You can still save the summary without links.
            </div>
          ) : (
            <>
              <p className="text-sm text-content-muted">
                Select entries to link to this summary. Higher relevance entries are auto-selected.
              </p>
              <div className="space-y-2">
                {relatedEntries.map(entry => {
                  const isSelected = selectedEntries.has(entry.id);
                  const relevance = relevancePercent(entry.distance);

                  return (
                    <button
                      key={entry.id}
                      onClick={() => toggleEntry(entry.id)}
                      aria-pressed={isSelected}
                      className={`w-full min-w-0 rounded-lg border p-4 text-left transition-colors ${focusRing} ${
                        isSelected
                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                          : 'border-edge bg-surface-raised hover:border-edge-strong hover:bg-surface-hover'
                      }`}
                    >
                      {/* The score and tick move below the text at 320px rather
                          than crushing the topic into a couple of characters. */}
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`break-all text-sm font-medium ${isSelected ? 'text-green-700 dark:text-green-400' : 'text-link'}`}>
                              {entry.id}
                            </span>
                            <span className="text-xs text-content-subtle">
                              {entry.type}
                            </span>
                          </div>
                          <div className="mt-1 break-words text-sm text-content">{entry.topic}</div>
                          <div className="mt-1 truncate text-xs text-content-subtle">
                            {entry.snippet}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-3 sm:ml-4">
                          <span className={`font-mono text-sm ${relevanceColor(relevance)}`}>
                            {relevance}%
                          </span>
                          <span aria-hidden="true" className={`text-lg ${isSelected ? 'text-green-700 dark:text-green-400' : 'text-content-subtle'}`}>
                            {isSelected ? '✓' : '○'}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Saving */}
      {step === 'saving' && (
        <div className="rounded-lg border border-edge bg-surface-raised p-6 text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <div className="h-3 w-3 animate-pulse rounded-full bg-green-600 dark:bg-green-500" />
            <div className="delay-75 h-3 w-3 animate-pulse rounded-full bg-green-600 dark:bg-green-500" />
            <div className="delay-150 h-3 w-3 animate-pulse rounded-full bg-green-600 dark:bg-green-500" />
          </div>
          <p className="text-content-muted">Saving summary...</p>
        </div>
      )}
    </div>
  );
}
