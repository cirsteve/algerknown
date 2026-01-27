import { IndexEntryRef } from '../../lib/api';
import { EntryCard, EntryCardSkeleton } from '../molecules/EntryCard';
import { EmptyState } from '../molecules/AlertBox';
import { LinkButton } from '../atoms/Button';

interface EntryGridProps {
  entries: IndexEntryRef[];
  loading?: boolean;
  emptyMessage?: string;
  columns?: 1 | 2 | 3;
  className?: string;
}

/**
 * EntryGrid organism - Grid layout of entry cards
 */
export function EntryGrid({ 
  entries, 
  loading = false,
  emptyMessage = 'No entries found',
  columns = 3,
  className = '' 
}: EntryGridProps) {
  const columnStyles = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  };

  if (loading) {
    return (
      <div className={`grid ${columnStyles[columns]} gap-4 ${className}`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <EntryCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        message={emptyMessage}
        icon="📝"
        action={
          <LinkButton to="/entries/new" variant="primary">
            Create New Entry
          </LinkButton>
        }
        className={className}
      />
    );
  }

  return (
    <div className={`grid ${columnStyles[columns]} gap-4 ${className}`}>
      {entries.map(entry => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

interface EntryListProps {
  entries: IndexEntryRef[];
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

/**
 * EntryList organism - Vertical list of entry cards
 */
export function EntryList({ 
  entries, 
  loading = false,
  emptyMessage = 'No entries found',
  className = '' 
}: EntryListProps) {
  if (loading) {
    return (
      <div className={`space-y-2 ${className}`}>
        {Array.from({ length: 5 }).map((_, i) => (
          <EntryCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        message={emptyMessage}
        className={className}
      />
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {entries.map(entry => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
