import { ChangelogEntry } from '../../lib/ragApi';

interface ChangeItemProps {
  change: ChangelogEntry;
  className?: string;
}

const typeConfig = {
  added: {
    color: 'bg-green-700 text-white dark:bg-green-600 dark:text-green-50',
    icon: '+',
    diffBg: 'bg-green-50 border-green-300 dark:bg-green-900/30 dark:border-green-800',
    diffText: 'text-green-700 dark:text-green-400',
  },
  modified: {
    color: 'bg-yellow-700 text-white dark:bg-yellow-600 dark:text-yellow-50',
    icon: '~',
    diffBg: 'bg-yellow-50 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-800',
    diffText: 'text-yellow-800 dark:text-yellow-400',
  },
  removed: {
    color: 'bg-red-700 text-white dark:bg-red-600 dark:text-red-50',
    icon: '-',
    diffBg: 'bg-red-50 border-red-300 dark:bg-red-900/30 dark:border-red-800',
    diffText: 'text-red-700 dark:text-red-400',
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
    <div className={`bg-surface-raised border border-edge rounded-lg p-4 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${config.color}`}
          >
            {config.icon}
          </span>
          <div>
            <div className="font-mono text-sm text-link">{change.path}</div>
            <div className="text-xs text-content-subtle">{formatTimestamp(change.timestamp)}</div>
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
  const { diffBg, diffText, icon } = typeConfig[variant];

  return (
    <div className={`mt-2 border rounded p-2 text-sm ${diffBg}`}>
      <span className={diffText}>{icon} </span>
      {/* formatValue pretty-prints objects, so the newlines and indentation
          have to survive; break-words handles a long unbroken scalar. */}
      <span className="whitespace-pre-wrap break-words text-content">{formatValue(value)}</span>
    </div>
  );
}
