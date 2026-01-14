import { Link } from 'react-router-dom';
import { IndexEntryRef } from '../lib/api';

interface EntryCardProps {
  entry: IndexEntryRef;
  topic?: string;
}

export function EntryCard({ entry, topic }: EntryCardProps) {
  const typeClass = entry.type === 'summary' 
    ? 'bg-blue-500/20 text-blue-300'
    : 'bg-green-500/20 text-green-300';
  
  return (
    <Link to={`/entries/${entry.id}`} className="entry-card block">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium text-slate-100">{topic || entry.id}</h3>
          <p className="text-sm text-slate-400 mt-1">{entry.id}</p>
        </div>
        <span className={`entry-type-badge ${typeClass}`}>
          {entry.type}
        </span>
      </div>
    </Link>
  );
}
