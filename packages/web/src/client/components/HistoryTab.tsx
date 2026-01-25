import { useState, useEffect } from 'react';
import { ragApi, ChangelogEntry, checkRagConnection } from '../lib/ragApi';

interface HistoryTabProps {
  entryId: string;
}

export function HistoryTab({ entryId }: HistoryTabProps) {
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);
  const [changes, setChanges] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkConnection();
  }, []);

  useEffect(() => {
    if (!ragConnected) return;

    const loadHistory = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await ragApi.getEntryHistory(entryId);
        setChanges(response.changes);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [ragConnected, entryId]);

  const checkConnection = async () => {
    const result = await checkRagConnection();
    setRagConnected(result.connected);
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
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
    if (typeof value === 'string') return value.length > 80 ? value.slice(0, 80) + '...' : value;
    if (typeof value === 'object') return JSON.stringify(value, null, 2).slice(0, 150);
    return String(value);
  };

  if (ragConnected === null) {
    return (
      <div className="bg-slate-800 rounded-lg p-6 text-center text-slate-400">
        Checking RAG connection...
      </div>
    );
  }

  if (!ragConnected) {
    return (
      <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 text-sm text-yellow-300">
        History requires RAG backend. Start it with{' '}
        <code className="bg-slate-800 px-1 rounded">docker-compose up</code>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-lg p-6 text-center text-slate-400">
        Loading history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">
        {error}
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg p-6 text-center text-slate-400">
        No change history recorded yet.
      </div>
    );
  }

  return (
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
                <div className="text-xs text-slate-500">{formatTimestamp(change.timestamp)}</div>
              </div>
            </div>
          </div>

          {/* Change detail */}
          {change.type === 'added' && (
            <div className="mt-2 bg-green-900/30 border border-green-800 rounded p-2 text-sm">
              <span className="text-green-400">+ </span>
              <span className="text-slate-300">{formatValue(change.value)}</span>
            </div>
          )}

          {change.type === 'removed' && (
            <div className="mt-2 bg-red-900/30 border border-red-800 rounded p-2 text-sm">
              <span className="text-red-400">- </span>
              <span className="text-slate-300">{formatValue(change.old)}</span>
            </div>
          )}

          {change.type === 'modified' && (
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
          )}
        </div>
      ))}
    </div>
  );
}
