import { useState, useEffect, useCallback } from 'react';
import { ragApi, ChangelogEntry, ChangelogStats, checkRagConnection } from '../lib/ragApi';

type ChangeTypeFilter = 'all' | 'added' | 'modified' | 'removed';

export function ChangesPage() {
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);
  const [changes, setChanges] = useState<ChangelogEntry[]>([]);
  const [stats, setStats] = useState<ChangelogStats | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<ChangeTypeFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    checkConnection();
  }, []);

  const loadData = useCallback(async () => {
    if (!ragConnected) return;

    setLoading(true);
    setError(null);

    try {
      // Load changes with filters
      const changelogResponse = await ragApi.getChangelog({
        limit,
        source: sourceFilter || undefined,
        change_type: typeFilter !== 'all' ? typeFilter : undefined,
      });
      setChanges(changelogResponse.changes);

      // Load stats and sources (only on initial load)
      if (!stats) {
        const [statsResponse, sourcesResponse] = await Promise.all([
          ragApi.getChangelogStats(),
          ragApi.getChangelogSources(),
        ]);
        setStats(statsResponse);
        setSources(sourcesResponse.sources);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load changelog');
    } finally {
      setLoading(false);
    }
  }, [ragConnected, typeFilter, sourceFilter, limit, stats]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const checkConnection = async () => {
    const result = await checkRagConnection();
    setRagConnected(result.connected);
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'added':
        return 'bg-green-600 text-green-100';
      case 'modified':
        return 'bg-yellow-600 text-yellow-100';
      case 'removed':
        return 'bg-red-600 text-red-100';
      default:
        return 'bg-slate-600 text-slate-100';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'added':
        return '+';
      case 'modified':
        return '~';
      case 'removed':
        return '-';
      default:
        return '?';
    }
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return value.length > 100 ? value.slice(0, 100) + '...' : value;
    if (typeof value === 'object') return JSON.stringify(value, null, 2).slice(0, 200);
    return String(value);
  };

  const renderChangeDetail = (change: ChangelogEntry) => {
    switch (change.type) {
      case 'added':
        return (
          <div className="mt-2 bg-green-900/30 border border-green-800 rounded p-2 text-sm">
            <span className="text-green-400">+ </span>
            <span className="text-slate-300">{formatValue(change.value)}</span>
          </div>
        );
      case 'removed':
        return (
          <div className="mt-2 bg-red-900/30 border border-red-800 rounded p-2 text-sm">
            <span className="text-red-400">- </span>
            <span className="text-slate-300">{formatValue(change.old)}</span>
          </div>
        );
      case 'modified':
        return (
          <div className="mt-2 space-y-1">
            <div className="bg-red-900/30 border border-red-800 rounded p-2 text-sm">
              <span className="text-red-400">- </span>
              <span className="text-slate-300">{formatValue(change.old)}</span>
            </div>
            <div className="bg-green-900/30 border border-green-800 rounded p-2 text-sm">
              <span className="text-green-400">+ </span>
              <span className="text-slate-300">{formatValue(change.new)}</span>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  if (ragConnected === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Checking RAG connection...</div>
      </div>
    );
  }

  if (!ragConnected) {
    return (
      <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-6 text-center">
        <h2 className="text-lg font-medium text-yellow-300 mb-2">RAG Backend Offline</h2>
        <p className="text-slate-400">
          The RAG backend is not available. Start it with{' '}
          <code className="bg-slate-800 px-2 py-1 rounded">docker-compose up</code> in the
          rag-backend directory.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Recent Changes</h1>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-slate-100">{stats.total_changes}</div>
            <div className="text-sm text-slate-400">Total Changes</div>
          </div>
          <div className="bg-green-900/30 border border-green-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-400">{stats.by_type.added}</div>
            <div className="text-sm text-green-300">Added</div>
          </div>
          <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-yellow-400">{stats.by_type.modified}</div>
            <div className="text-sm text-yellow-300">Modified</div>
          </div>
          <div className="bg-red-900/30 border border-red-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-red-400">{stats.by_type.removed}</div>
            <div className="text-sm text-red-300">Removed</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 items-center bg-slate-800 rounded-lg p-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Type:</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ChangeTypeFilter)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1 text-sm"
          >
            <option value="all">All</option>
            <option value="added">Added</option>
            <option value="modified">Modified</option>
            <option value="removed">Removed</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Source:</label>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1 text-sm"
          >
            <option value="">All Sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source.split('/').pop()}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">Limit:</label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1 text-sm"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">
          {error}
        </div>
      )}

      {/* Changes List */}
      {changes.length === 0 && !loading ? (
        <div className="bg-slate-800 rounded-lg p-8 text-center text-slate-400">
          No changes recorded yet. Changes will appear here after you ingest entries.
        </div>
      ) : (
        <div className="space-y-3">
          {changes.map((change, index) => (
            <div
              key={`${change.timestamp}-${change.path}-${index}`}
              className="bg-slate-800 border border-slate-700 rounded-lg p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${getTypeColor(
                      change.type
                    )}`}
                  >
                    {getTypeIcon(change.type)}
                  </span>
                  <div>
                    <div className="font-mono text-sm text-sky-400">{change.path}</div>
                    <div className="text-xs text-slate-500">
                      {change.source.split('/').pop()}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-500">{formatTimestamp(change.timestamp)}</div>
              </div>

              {renderChangeDetail(change)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
