import { useState, useEffect, type ReactNode } from 'react';
import { ChangelogEntry, checkRagConnection, ragApi } from '../../lib/ragApi';
import { ChangeItem, GovernedRevisionItem } from '../molecules/ChangeItem';
import { AlertBox, EmptyState } from '../molecules/AlertBox';
import { LoadingState } from '../atoms/Spinner';
import { useAcceptedRevisionIndex, useNodeHistory } from '../../hooks/useGovernance';

interface HistoryListProps {
  entryId: string;
  className?: string;
  /** When set (from ?node=&namespace= on the entry route), also shows this governed node's revision history, attributed and linked to the proposal that produced each revision. */
  governedNamespace?: string;
  governedNodeId?: string;
}

/** The governed counterpart of the legacy changelog list below: one node's immutable revision history, each entry linked to its originating proposal when one can be found in the accepted queue. */
function GovernedHistorySection({ namespace, nodeId }: { namespace: string; nodeId: string }) {
  const { revisions, isLoading, error } = useNodeHistory(namespace, nodeId);
  const revisionIndex = useAcceptedRevisionIndex(namespace);

  if (isLoading) return <LoadingState message="Loading governed history..." />;
  if (error) return <AlertBox variant="error">Failed to load governed history: {error.message}</AlertBox>;
  if (!revisions || revisions.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-400">Governed revisions for {nodeId}</h3>
      {revisions.map((revision) => (
        <GovernedRevisionItem key={revision.revisionId} revision={revision} proposalId={revisionIndex.get(revision.namespaceRevision)} />
      ))}
    </div>
  );
}

/**
 * HistoryList organism - Displays change history for an entry
 */
export function HistoryList({ entryId, className = '', governedNamespace, governedNodeId }: HistoryListProps) {
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

  // Governed history is independent of the legacy RAG changelog's own
  // connectivity/loading state, so it's computed once and rendered
  // alongside whichever state the legacy section below ends up in.
  const governedSection = governedNamespace && governedNodeId ? <GovernedHistorySection namespace={governedNamespace} nodeId={governedNodeId} /> : null;

  let legacySection: ReactNode;
  if (ragConnected === null) {
    legacySection = <LoadingState message="Checking RAG connection..." />;
  } else if (!ragConnected) {
    legacySection = (
      <AlertBox variant="warning">
        History requires RAG backend. Start it with <code className="bg-slate-800 px-1 rounded">docker-compose up</code>
      </AlertBox>
    );
  } else if (loading) {
    legacySection = <LoadingState message="Loading history..." />;
  } else if (error) {
    legacySection = <AlertBox variant="error">{error}</AlertBox>;
  } else if (changes.length === 0) {
    legacySection = <EmptyState message="No change history recorded yet" description="Changes will appear here when the entry is modified" icon="📜" />;
  } else {
    legacySection = (
      <div className="space-y-3">
        {changes.map((change, index) => (
          <ChangeItem key={`${change.timestamp}-${change.path}-${index}`} change={change} />
        ))}
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {governedSection}
      {legacySection}
    </div>
  );
}
