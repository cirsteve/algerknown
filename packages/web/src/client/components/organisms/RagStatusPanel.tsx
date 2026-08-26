import { useState, useEffect } from 'react';
import { StatusIndicator } from '../atoms/StatusIndicator';
import { Button } from '../atoms/Button';
import { AlertBox } from '../molecules/AlertBox';
import { checkRagConnection } from '../../lib/ragApi';

interface RagStatusPanelProps {
  className?: string;
  showRetry?: boolean;
  showDocCount?: boolean;
}

/**
 * RagStatusPanel organism - Displays RAG backend connection status
 */
export function RagStatusPanel({ 
  className = '',
  showRetry = true,
  showDocCount = true,
}: RagStatusPanelProps) {
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);
  const [documentsIndexed, setDocumentsIndexed] = useState<number>(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setChecking(true);
    const result = await checkRagConnection();
    setRagConnected(result.connected);
    if (result.status) {
      setDocumentsIndexed(result.status.documents_indexed);
    }
    setChecking(false);
  };

  const connectionStatus = checking 
    ? 'checking' 
    : ragConnected === null 
      ? 'unknown' 
      : ragConnected 
        ? 'online' 
        : 'offline';

  const statusLabel = checking
    ? 'Checking...'
    : ragConnected === null
      ? 'RAG Unknown'
      : ragConnected
        ? showDocCount 
          ? `RAG Online (${documentsIndexed} docs)`
          : 'RAG Online'
        : 'RAG Offline';

  return (
    /* The status readout sits next to a page title on wide screens and under it
       on narrow ones; wrapping keeps the Retry button on the row rather than
       pushing the label out of the viewport. */
    <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <StatusIndicator status={connectionStatus} />
      <span className="text-sm text-content-muted">{statusLabel}</span>

      {showRetry && !ragConnected && ragConnected !== null && !checking && (
        <Button variant="ghost" size="sm" onClick={checkConnection}>
          Retry
        </Button>
      )}
    </div>
  );
}

interface RagOfflineNoticeProps {
  className?: string;
}

/**
 * RagOfflineNotice organism - Full notice when RAG is offline
 */
export function RagOfflineNotice({ className = '' }: RagOfflineNoticeProps) {
  return (
    <AlertBox 
      variant="warning" 
      title="RAG Backend Offline"
      className={className}
    >
      <p className="break-words">
        The RAG backend is not available. Start it with{' '}
        <code className="rounded bg-surface-sunken px-2 py-1 text-content">docker-compose up</code> in the
        rag-backend directory.
      </p>
    </AlertBox>
  );
}
