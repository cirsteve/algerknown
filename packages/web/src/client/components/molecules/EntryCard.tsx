import { Link } from 'react-router-dom';
import { TypeBadge } from '../atoms/Badge';
import { IndexEntryRef } from '../../lib/api';

interface EntryCardProps {
  entry: IndexEntryRef;
  topic?: string;
  className?: string;
}

/**
 * EntryCard molecule - A clickable card displaying entry information
 * 
 * Combines: Link, TypeBadge
 */
export function EntryCard({ entry, topic, className = '' }: EntryCardProps) {
  return (
    <Link 
      to={`/entries/${entry.id}`} 
      className={`
        block rounded-lg border border-edge bg-surface-raised p-4
        transition-colors cursor-pointer hover:bg-surface-hover
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface
        ${className}
      `}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-content truncate">
            {topic || entry.id}
          </h3>
          <p className="text-sm text-content-muted mt-1 truncate">{entry.id}</p>
        </div>
        <TypeBadge type={entry.type} className="ml-2 flex-shrink-0" />
      </div>
    </Link>
  );
}

interface EntryCardSkeletonProps {
  className?: string;
}

/**
 * EntryCardSkeleton molecule - Loading state for EntryCard
 */
export function EntryCardSkeleton({ className = '' }: EntryCardSkeletonProps) {
  return (
    <div className={`rounded-lg border border-edge bg-surface-raised p-4 animate-pulse ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="h-5 bg-surface-muted rounded w-3/4" />
          <div className="h-4 bg-surface-muted rounded w-1/2 mt-2" />
        </div>
        <div className="h-5 w-16 bg-surface-muted rounded-full" />
      </div>
    </div>
  );
}
