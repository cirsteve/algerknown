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
    <div className={`flex items-center gap-2 ${className}`}>
      <StatusIndicator status={connectionStatus} />
      <span className="text-sm text-slate-400">{statusLabel}</span>
      
      {showRetry && !ragConnected && ragConnected !== null && !checking && (
        <Button
          variant="ghost"
          size="sm"
          onClick={checkConnection}
          className="text-sky-400"
        >
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
      <p>
        The RAG backend is not available. Start it with{' '}
        <code className="bg-slate-800 px-2 py-1 rounded">docker-compose up</code> in the
        rag-backend directory.
      </p>
    </AlertBox>
  );
}
