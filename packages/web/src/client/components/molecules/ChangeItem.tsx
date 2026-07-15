import { Link } from 'react-router-dom';
import { ChangelogEntry } from '../../lib/ragApi';
import type { RevisionRecord } from '../../lib/governanceApi';

interface ChangeItemProps {
  change: ChangelogEntry;
  className?: string;
}

const typeConfig = {
  added: {
    color: 'bg-green-600 text-green-100',
    icon: '+',
    diffBg: 'bg-green-900/30 border-green-800',
    diffText: 'text-green-400',
  },
  modified: {
    color: 'bg-yellow-600 text-yellow-100',
    icon: '~',
    diffBg: 'bg-yellow-900/30 border-yellow-800',
    diffText: 'text-yellow-400',
  },
  removed: {
    color: 'bg-red-600 text-red-100',
    icon: '-',
    diffBg: 'bg-red-900/30 border-red-800',
    diffText: 'text-red-400',
  },
} as const;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.length > 80 ? value.slice(0, 80) + '...' : value;
  if (typeof value === 'object') return JSON.stringify(value, null, 2).slice(0, 150);
  return String(value);
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * ChangeItem molecule - Displays a single changelog entry
 */
export function ChangeItem({ change, className = '' }: ChangeItemProps) {
  const config = typeConfig[change.type as keyof typeof typeConfig] || typeConfig.modified;

  return (
    <div className={`bg-slate-800 border border-slate-700 rounded-lg p-4 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${config.color}`}
          >
            {config.icon}
          </span>
          <div>
            <div className="font-mono text-sm text-sky-400">{change.path}</div>
            <div className="text-xs text-slate-500">{formatTimestamp(change.timestamp)}</div>
          </div>
        </div>
      </div>

      {/* Change detail */}
      {change.type === 'added' && (
        <DiffBlock variant="added" value={change.value} />
      )}

      {change.type === 'removed' && (
        <DiffBlock variant="removed" value={change.old} />
      )}

      {change.type === 'modified' && (
        <div className="mt-2 space-y-1">
          <DiffBlock variant="removed" value={change.old} />
          <DiffBlock variant="added" value={change.new} />
        </div>
      )}
    </div>
  );
}

interface GovernedRevisionItemProps {
  revision: RevisionRecord;
  /** The proposal that produced this revision, when it could be cross-referenced from the accepted queue. */
  proposalId?: string;
  className?: string;
}

/**
 * ChangeItem's governed counterpart: renders one immutable namespace
 * revision (per-entity field changes, actor, and a link to the proposal
 * that produced it) in the same card shell as the legacy changelog, so
 * HistoryList can show both in one visual language.
 */
export function GovernedRevisionItem({ revision, proposalId, className = '' }: GovernedRevisionItemProps) {
  return (
    <div className={`bg-slate-800 border border-slate-700 rounded-lg p-4 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold bg-sky-600 text-sky-100">#{revision.namespaceRevision}</span>
          <div>
            <div className="text-sm text-slate-300">
              {revision.actorId} <span className="text-slate-500">({revision.actorClass})</span>
            </div>
            <div className="text-xs text-slate-500">{formatTimestamp(revision.createdAt)}</div>
          </div>
        </div>
        {proposalId && (
          <Link to={`/ingest?tab=accepted&proposal=${proposalId}`} className="text-xs text-sky-400 hover:text-sky-300 underline">
            proposal {proposalId}
          </Link>
        )}
      </div>

      <div className="mt-2 space-y-1">
        {revision.diff.map((entry, i) => (
          <div key={`${entry.entityId}-${i}`} className="rounded p-2 text-sm bg-slate-900/50 border border-slate-700">
            <div className="text-xs text-slate-500">
              {entry.changeKind} {entry.entityKind} <span className="font-mono text-sky-400">{entry.entityId}</span>
            </div>
            {entry.forward.map((field, j) => (
              <div key={j} className="mt-1 text-xs">
                <span className="font-mono text-slate-500">{field.path}</span>: <span className="text-red-400">{formatValue(field.before)}</span> →{' '}
                <span className="text-green-400">{formatValue(field.after)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface DiffBlockProps {
  variant: 'added' | 'removed';
  value: unknown;
}

/**
 * DiffBlock molecule - Shows added or removed content
 */
function DiffBlock({ variant, value }: DiffBlockProps) {
  const isAdded = variant === 'added';
  const bgClass = isAdded ? 'bg-green-900/30 border-green-800' : 'bg-red-900/30 border-red-800';
  const textClass = isAdded ? 'text-green-400' : 'text-red-400';
  const prefix = isAdded ? '+' : '-';

  return (
    <div className={`mt-2 border rounded p-2 text-sm ${bgClass}`}>
      <span className={textClass}>{prefix} </span>
      <span className="text-slate-300">{formatValue(value)}</span>
    </div>
  );
}
