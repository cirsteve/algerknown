import { ChangelogEntry } from '../../lib/ragApi';

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
