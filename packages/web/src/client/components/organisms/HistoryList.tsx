import { useState, useEffect } from 'react';
import { ChangelogEntry, checkRagConnection, ragApi } from '../../lib/ragApi';
import { ChangeItem } from '../molecules/ChangeItem';
import { AlertBox, EmptyState } from '../molecules/AlertBox';
import { LoadingState } from '../atoms/Spinner';

interface HistoryListProps {
  entryId: string;
  className?: string;
}

/**
 * HistoryList organism - Displays change history for an entry
 */
export function HistoryList({ entryId, className = '' }: HistoryListProps) {
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

  if (ragConnected === null) {
    return <LoadingState message="Checking RAG connection..." className={className} />;
  }

  if (!ragConnected) {
    return (
      <AlertBox variant="warning" className={className}>
        History requires RAG backend. Start it with{' '}
        <code className="bg-slate-800 px-1 rounded">docker-compose up</code>
      </AlertBox>
    );
  }

  if (loading) {
    return <LoadingState message="Loading history..." className={className} />;
  }

  if (error) {
    return (
      <AlertBox variant="error" className={className}>
        {error}
      </AlertBox>
    );
  }

  if (changes.length === 0) {
    return (
      <EmptyState
        message="No change history recorded yet"
        description="Changes will appear here when the entry is modified"
        icon="📜"
        className={className}
      />
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {changes.map((change, index) => (
        <ChangeItem
          key={`${change.timestamp}-${change.path}-${index}`}
          change={change}
        />
      ))}
    </div>
  );
}
