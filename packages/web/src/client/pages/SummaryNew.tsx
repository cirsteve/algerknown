import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ragApi, RagSearchResult } from '../lib/ragApi';

type Step = 'create' | 'analyzing' | 'review' | 'saving';

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
  const tags = tagsInput
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  const handleAnalyze = async () => {
    if (!topic.trim() || !summary.trim()) {
      setError('Topic and summary are required');
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
        date: new Date().toISOString().split('T')[0],
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
    if (!topic.trim() || !summary.trim()) {
      setError('Topic and summary are required');
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
        date: new Date().toISOString().split('T')[0],
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-100">New Summary</h1>

      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 text-red-200">
          {error}
        </div>
      )}

      {/* Form */}
      {(step === 'create' || step === 'review') && (
        <div className="bg-slate-800 rounded-lg p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Topic *
            </label>
            <input
              type="text"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. Vector Database Performance Tuning"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
              disabled={step === 'review'}
            />
            {topic && (
              <p className="text-xs text-slate-500 mt-1">ID: {id}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Summary *
            </label>
            <textarea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Write your summary here..."
              rows={8}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
              disabled={step === 'review'}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="e.g. performance, databases, tuning"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                disabled={step === 'review'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
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
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleAnalyze}
                disabled={!topic.trim() || !summary.trim() || loading}
                className="bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-2 rounded-lg font-medium transition-colors"
              >
                Find Related Entries
              </button>
              <button
                onClick={handleSaveWithoutAnalysis}
                disabled={!topic.trim() || !summary.trim() || loading}
                className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-2 rounded-lg text-slate-300 transition-colors"
              >
                Save Without Analysis
              </button>
            </div>
          )}
        </div>
      )}

      {/* Analyzing */}
      {step === 'analyzing' && (
        <div className="bg-slate-800 rounded-lg p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-3 h-3 bg-sky-500 rounded-full animate-pulse" />
            <div className="w-3 h-3 bg-sky-500 rounded-full animate-pulse delay-75" />
            <div className="w-3 h-3 bg-sky-500 rounded-full animate-pulse delay-150" />
          </div>
          <p className="text-slate-300">Searching for related entries...</p>
        </div>
      )}

      {/* Review related entries */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-slate-100">
              Related Entries ({relatedEntries.length} found)
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('create'); setRelatedEntries([]); setSelectedEntries(new Set()); }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
              >
                Back to Edit
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium"
              >
                {loading ? 'Saving...' : `Save Summary${selectedEntries.size > 0 ? ` with ${selectedEntries.size} Links` : ''}`}
              </button>
            </div>
          </div>

          {relatedEntries.length === 0 ? (
            <div className="bg-slate-800 rounded-lg p-6 text-center text-slate-400">
              No related entries found. You can still save the summary without links.
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-400">
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
                      className={`w-full text-left border rounded-lg p-4 transition-colors ${
                        isSelected
                          ? 'border-green-500 bg-green-900/20'
                          : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${isSelected ? 'text-green-400' : 'text-sky-400'}`}>
                              {entry.id}
                            </span>
                            <span className="text-xs text-slate-500">
                              {entry.type}
                            </span>
                          </div>
                          <div className="text-sm text-slate-300 mt-1">{entry.topic}</div>
                          <div className="text-xs text-slate-500 mt-1 truncate">
                            {entry.snippet}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 ml-4">
                          <span className={`text-sm font-mono ${
                            relevance >= 70 ? 'text-green-400' :
                            relevance >= 40 ? 'text-yellow-400' :
                            'text-slate-500'
                          }`}>
                            {relevance}%
                          </span>
                          <span className={`text-lg ${isSelected ? 'text-green-400' : 'text-slate-600'}`}>
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
        <div className="bg-slate-800 rounded-lg p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse delay-75" />
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse delay-150" />
          </div>
          <p className="text-slate-300">Saving summary...</p>
        </div>
      )}
    </div>
  );
}
