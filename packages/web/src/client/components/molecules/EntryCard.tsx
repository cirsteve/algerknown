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
        block bg-slate-800 rounded-lg p-4 
        hover:bg-slate-700 transition-colors cursor-pointer
        ${className}
      `}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-slate-100 truncate">
            {topic || entry.id}
          </h3>
          <p className="text-sm text-slate-400 mt-1 truncate">{entry.id}</p>
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
    <div className={`bg-slate-800 rounded-lg p-4 animate-pulse ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="h-5 bg-slate-700 rounded w-3/4" />
          <div className="h-4 bg-slate-700 rounded w-1/2 mt-2" />
        </div>
        <div className="h-5 w-16 bg-slate-700 rounded-full" />
      </div>
    </div>
  );
}
