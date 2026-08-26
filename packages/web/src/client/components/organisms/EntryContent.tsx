import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Entry, Link as EntryLink } from '../../lib/api';

interface EntryContentProps {
  entry: Entry;
  className?: string;
}

/*
 * Entry bodies are arbitrary YAML, so every value here is content the layout did
 * not choose: an unbroken id, a path, a serialized object. `min-w-0` on each card
 * plus wrapping (or a contained scroll region for `<pre>`) keeps that content from
 * widening the document at 320px.
 */
const card = 'min-w-0 rounded-lg border border-edge bg-surface-raised p-4 sm:p-6';

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
    <div className={`min-w-0 space-y-6 ${className}`}>
      {/* Main Content */}
      <div className={`${card} space-y-4`}>
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
      return <p className="whitespace-pre-wrap break-words">{val}</p>;
    }

    if (Array.isArray(val)) {
      return (
        <ul className="list-inside list-disc space-y-1">
          {val.map((item, i) => (
            <li key={i} className="break-words">
              {typeof item === 'object' ? JSON.stringify(item) : String(item)}
            </li>
          ))}
        </ul>
      );
    }

    if (typeof val === 'object' && val !== null) {
      return (
        <pre className="max-h-64 overflow-auto rounded border border-edge bg-surface-sunken p-3 text-sm text-content">
          {JSON.stringify(val, null, 2)}
        </pre>
      );
    }

    return <span className="break-words">{String(val)}</span>;
  };

  return (
    <div className="min-w-0">
      <label className="text-sm uppercase tracking-wide text-content-muted">
        {formatLabel(name)}
      </label>
      <div className="mt-1 min-w-0 text-content">
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
    <div className={card}>
      <h2 className="mb-4 text-base font-semibold text-content-strong sm:text-lg">Links</h2>
      <div className="space-y-3">
        {links.map((link, idx) => (
          /* Relationship, target and note only fit one row from `sm` up; below
             that they wrap rather than pushing the id out of the viewport. */
          <div key={idx} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded bg-control px-2 py-1 text-xs text-content">
              {link.relationship.replace(/_/g, ' ')}
            </span>
            <Link
              to={`/entries/${link.id}`}
              className="break-all rounded-sm text-link transition-colors hover:text-link-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {link.id}
            </Link>
            {link.notes && (
              <span className="w-full break-words text-sm text-content-subtle sm:w-auto">— {link.notes}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
