import { useEffect, useRef } from 'react';
import { Button } from '../atoms/Button';
import { LoadingState } from '../atoms/Spinner';
import { AlertBox, EmptyState } from '../molecules/AlertBox';
import { useProposalQueue } from '../../hooks/useGovernance';
import type { DurableProposalStatus } from '../../lib/governanceApi';
import { ProposalCard } from './ProposalCard';

interface GovernanceQueueProps {
  status: DurableProposalStatus;
  namespace: string;
  cursor: string | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCursorChange: (cursor: string | undefined) => void;
  onNamespacesObserved: (namespaces: string[]) => void;
}

export function GovernanceQueue({ status, namespace, cursor, selectedId, onSelect, onCursorChange, onNamespacesObserved }: GovernanceQueueProps) {
  const { page, error, mutate } = useProposalQueue({ status, namespace: namespace || undefined, cursor, limit: 50 });

  const observedRef = useRef(onNamespacesObserved);
  observedRef.current = onNamespacesObserved;
  useEffect(() => {
    if (page) observedRef.current(page.items.map((item) => item.targetNamespace));
  }, [page]);

  // Not just `isLoading`: SWR reports isLoading=false while its key is still
  // null (e.g. the auth session hasn't resolved yet), which would otherwise
  // flash a false "no proposals" empty state before the real fetch starts.
  if (!page && !error) {
    return <LoadingState message="Loading proposals..." />;
  }

  if (error) {
    return (
      <AlertBox variant="error">
        Failed to load the proposal queue: {error.message}{' '}
        <button className="underline" onClick={() => mutate()}>
          Retry
        </button>
      </AlertBox>
    );
  }

  const items = page?.items ?? [];

  if (items.length === 0) {
    return <EmptyState message={`No ${status} proposals`} description="Proposals will appear here as the RAG ingest pipeline or dossier writes submit them." icon="📋" />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ProposalCard key={item.id} item={item} selected={item.id === selectedId} onSelect={() => onSelect(item.id)} />
      ))}
      {page?.nextCursor && (
        <Button variant="secondary" size="sm" onClick={() => onCursorChange(page.nextCursor ?? undefined)}>
          Load more
        </Button>
      )}
    </div>
  );
}
