import type { ReactNode } from 'react';
import { Badge } from '../atoms/Badge';
import { formatTimestamp } from '../../lib/format';
import type { ProposalEvent, ReversalInfo } from '../../lib/governanceApi';

interface ProposalHistoryProps {
  events: ProposalEvent[];
  reversal: ReversalInfo | null;
  revertSlot?: ReactNode;
}

/** Full proposal event timeline plus its reversal chain, if any -- the linked node/revision/reversal history surface. */
export function ProposalHistory({ events, reversal, revertSlot }: ProposalHistoryProps) {
  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.eventId} className="bg-slate-900/50 rounded p-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="default">{event.kind}</Badge>
              <span className="text-xs text-slate-500">{formatTimestamp(event.at)}</span>
              {event.actorId && <span className="text-xs text-slate-400 font-mono">{event.actorId}</span>}
              {event.proposalVersion !== undefined && <span className="text-xs text-slate-500">v{event.proposalVersion}</span>}
            </div>
            {event.reason && <div className="mt-1 text-slate-300">{event.reason}</div>}
            {event.note && <div className="mt-1 text-slate-300">{event.note}</div>}
          </li>
        ))}
      </ul>

      {reversal && (
        <div className="bg-red-900/20 border border-red-800 rounded p-3 text-sm space-y-1">
          <div className="font-medium text-red-300">Reverted</div>
          <div className="text-slate-300">
            Revision <span className="font-mono">{reversal.originalRevision}</span> → <span className="font-mono">{reversal.newRevision}</span>
          </div>
          <div className="text-slate-400">{reversal.reason}</div>
          <div className="text-xs text-slate-500">
            {reversal.actorId} · {formatTimestamp(reversal.createdAt)}
          </div>
        </div>
      )}

      {revertSlot}
    </div>
  );
}
