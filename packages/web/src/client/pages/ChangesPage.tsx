import { useState, useEffect, useCallback } from 'react';
import { ragApi, ChangelogEntry, ChangelogStats, checkRagConnection } from '../lib/ragApi';
import { AlertBox } from '../components/molecules/AlertBox';

type ChangeTypeFilter = 'all' | 'added' | 'modified' | 'removed';

/* Each change type keeps its hue as the semantic; only the contrast pairing
 * differs between the two schemes. */
const typeChip: Record<string, string> = {
  added: 'bg-green-700 text-white dark:bg-green-600 dark:text-green-50',
  modified: 'bg-yellow-700 text-white dark:bg-yellow-600 dark:text-yellow-50',
  removed: 'bg-red-700 text-white dark:bg-red-600 dark:text-red-50',
};

const diffStyles = {
  added: {
    box: 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-900/30',
    marker: 'text-green-700 dark:text-green-400',
  },
  removed: {
    box: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/30',
    marker: 'text-red-700 dark:text-red-400',
  },
};

const filterSelect =
  'w-full rounded border border-edge bg-surface-sunken px-3 py-1 text-sm text-content transition-colors hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 sm:w-auto';

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

  const getTypeColor = (type: string) => typeChip[type] || 'bg-control text-content';

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

  // Diff values are arbitrary content, so they wrap inside the block rather
  // than widening it.
  const diffBlock = (variant: 'added' | 'removed', value: unknown) => {
    const { box, marker } = diffStyles[variant];
    return (
      <div className={`rounded border p-2 text-sm ${box}`}>
        <span className={marker}>{variant === 'added' ? '+ ' : '- '}</span>
        <span className="whitespace-pre-wrap break-words text-content">{formatValue(value)}</span>
      </div>
    );
  };

  const renderChangeDetail = (change: ChangelogEntry) => {
    switch (change.type) {
      case 'added':
        return <div className="mt-2">{diffBlock('added', change.value)}</div>;
      case 'removed':
        return <div className="mt-2">{diffBlock('removed', change.old)}</div>;
      case 'modified':
        return (
          <div className="mt-2 space-y-1">
            {diffBlock('removed', change.old)}
            {diffBlock('added', change.new)}
          </div>
        );
      default:
        return null;
    }
  };

  if (ragConnected === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-content-muted">Checking RAG connection...</div>
      </div>
    );
  }

  if (!ragConnected) {
    return (
      <AlertBox variant="warning" title="RAG Backend Offline">
        <p className="break-words">
          The RAG backend is not available. Start it with{' '}
          <code className="rounded bg-surface-sunken px-2 py-1 text-content">docker-compose up</code> in the
          rag-backend directory.
        </p>
      </AlertBox>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 text-xl font-bold text-content-strong sm:text-2xl">Recent Changes</h1>
        <button
          onClick={loadData}
          disabled={loading}
          className="rounded-lg bg-control px-4 py-2 text-sm text-content transition-colors hover:bg-control-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 sm:shrink-0"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Stats - four tiles need roughly 40rem, so they run two-up at 320px. */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="min-w-0 rounded-lg border border-edge bg-surface-raised p-4">
            <div className="text-2xl font-bold text-content-strong">{stats.total_changes}</div>
            <div className="text-sm text-content-muted">Total Changes</div>
          </div>
          <div className="min-w-0 rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/30">
            <div className="text-2xl font-bold text-green-800 dark:text-green-400">{stats.by_type.added}</div>
            <div className="text-sm text-green-700 dark:text-green-300">Added</div>
          </div>
          <div className="min-w-0 rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/30">
            <div className="text-2xl font-bold text-yellow-800 dark:text-yellow-400">{stats.by_type.modified}</div>
            <div className="text-sm text-yellow-700 dark:text-yellow-300">Modified</div>
          </div>
          <div className="min-w-0 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
            <div className="text-2xl font-bold text-red-800 dark:text-red-400">{stats.by_type.removed}</div>
            <div className="text-sm text-red-700 dark:text-red-300">Removed</div>
          </div>
        </div>
      )}

      {/* Filters - a label and a select per filter is wider than 320px three
          times over, so each filter is a stacked block until `sm`. */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-edge bg-surface-raised p-4 sm:grid-cols-3 sm:items-center sm:gap-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <label htmlFor="changes-type" className="text-sm text-content-muted">Type:</label>
          <select
            id="changes-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ChangeTypeFilter)}
            className={filterSelect}
          >
            <option value="all">All</option>
            <option value="added">Added</option>
            <option value="modified">Modified</option>
            <option value="removed">Removed</option>
          </select>
        </div>

        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <label htmlFor="changes-source" className="text-sm text-content-muted">Source:</label>
          <select
            id="changes-source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className={filterSelect}
          >
            <option value="">All Sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source.split('/').pop()}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <label htmlFor="changes-limit" className="text-sm text-content-muted">Limit:</label>
          <select
            id="changes-limit"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className={filterSelect}
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
        <AlertBox variant="error">
          <span className="block break-words">{error}</span>
        </AlertBox>
      )}

      {/* Changes List */}
      {changes.length === 0 && !loading ? (
        <div className="rounded-lg border border-edge bg-surface-raised p-6 text-center text-content-muted sm:p-8">
          No changes recorded yet. Changes will appear here after you ingest entries.
        </div>
      ) : (
        <div className="space-y-3">
          {changes.map((change, index) => (
            <div
              key={`${change.timestamp}-${change.path}-${index}`}
              className="min-w-0 rounded-lg border border-edge bg-surface-raised p-4"
            >
              {/* The relative timestamp drops below the path at 320px rather
                  than truncating it. */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold ${getTypeColor(
                      change.type
                    )}`}
                  >
                    {getTypeIcon(change.type)}
                  </span>
                  <div className="min-w-0">
                    <div className="break-all font-mono text-sm text-link">{change.path}</div>
                    <div className="break-all text-xs text-content-subtle">
                      {change.source.split('/').pop()}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-content-subtle sm:shrink-0">{formatTimestamp(change.timestamp)}</div>
              </div>

              {renderChangeDetail(change)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
