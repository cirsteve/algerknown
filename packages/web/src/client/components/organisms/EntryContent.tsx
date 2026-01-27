import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Entry, Link as EntryLink } from '../../lib/api';

interface EntryContentProps {
  entry: Entry;
  className?: string;
}

/**
 * EntryContent organism - Displays the full content of an entry
 */
export function EntryContent({ entry, className = '' }: EntryContentProps) {
  // Fields to hide from the generic display
  const hiddenFields = ['id', 'type', 'links', 'topic', 'status', 'tags'];
  const displayFields = Object.entries(entry).filter(
    ([key]) => !hiddenFields.includes(key)
  );

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Main Content */}
      <div className="bg-slate-800 rounded-lg p-6 space-y-4">
        {displayFields.map(([key, value]) => (
          <FieldDisplay key={key} name={key} value={value} />
        ))}
      </div>

      {/* Links Section */}
      {entry.links && entry.links.length > 0 && (
        <LinksSection links={entry.links} />
      )}
    </div>
  );
}

interface FieldDisplayProps {
  name: string;
  value: unknown;
}

/**
 * FieldDisplay - Renders a single field from an entry
 */
function FieldDisplay({ name, value }: FieldDisplayProps) {
  const formatLabel = (key: string) => key.replace(/_/g, ' ');

  const renderValue = (val: unknown): ReactNode => {
    if (typeof val === 'string') {
      return <p className="whitespace-pre-wrap">{val}</p>;
    }
    
    if (Array.isArray(val)) {
      return (
        <ul className="list-disc list-inside space-y-1">
          {val.map((item, i) => (
            <li key={i}>
              {typeof item === 'object' ? JSON.stringify(item) : String(item)}
            </li>
          ))}
        </ul>
      );
    }
    
    if (typeof val === 'object' && val !== null) {
      return (
        <pre className="bg-slate-900 p-3 rounded text-sm overflow-x-auto">
          {JSON.stringify(val, null, 2)}
        </pre>
      );
    }
    
    return <span>{String(val)}</span>;
  };

  return (
    <div>
      <label className="text-sm text-slate-400 uppercase tracking-wide">
        {formatLabel(name)}
      </label>
      <div className="mt-1 text-slate-100">
        {renderValue(value)}
      </div>
    </div>
  );
}

interface LinksSectionProps {
  links: EntryLink[];
}

/**
 * LinksSection - Displays linked entries
 */
function LinksSection({ links }: LinksSectionProps) {
  return (
    <div className="bg-slate-800 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-slate-200 mb-4">Links</h2>
      <div className="space-y-3">
        {links.map((link, idx) => (
          <div key={idx} className="flex items-center gap-3">
            <span className="text-xs px-2 py-1 bg-slate-700 rounded text-slate-400">
              {link.relationship.replace(/_/g, ' ')}
            </span>
            <Link
              to={`/entries/${link.id}`}
              className="text-sky-400 hover:text-sky-300"
            >
              {link.id}
            </Link>
            {link.notes && (
              <span className="text-sm text-slate-500">— {link.notes}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
