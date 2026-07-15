import { Badge } from '../atoms/Badge';
import { formatRelativeTimeIso } from '../../lib/format';
import type { ProposalQueueItem } from '../../lib/governanceApi';

const STATUS_VARIANT: Record<ProposalQueueItem['status'], 'warning' | 'success' | 'danger' | 'default'> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
  expired: 'default',
  deleted: 'default',
};

interface ProposalCardProps {
  item: ProposalQueueItem;
  selected: boolean;
  onSelect: () => void;
}

/** Queue triage card: only fields the queue endpoint actually returns are shown -- no fabricated confidence/source/diff summary. */
export function ProposalCard({ item, selected, onSelect }: ProposalCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full text-left rounded-lg border p-4 transition-colors ${
        selected ? 'border-sky-500 bg-sky-900/20' : 'border-slate-700 bg-slate-800 hover:border-slate-600'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge>
            {item.reverted && <Badge variant="danger">reverted</Badge>}
          </div>
          <div className="mt-1 font-mono text-sm text-sky-400 truncate">{item.targetSubject}</div>
          <div className="text-xs text-slate-500 truncate">{item.targetNamespace}</div>
        </div>
        <div className="text-right text-xs text-slate-500 whitespace-nowrap">
          <div>v{item.version}</div>
          <div>{formatRelativeTimeIso(item.createdAt)}</div>
        </div>
      </div>
      {item.resultingRevision !== null && <div className="mt-2 text-xs text-slate-500">Resulting revision: {item.resultingRevision}</div>}
    </button>
  );
}
