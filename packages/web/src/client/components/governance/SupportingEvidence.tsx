import { Badge } from '../atoms/Badge';
import type { EdgeMutation } from '../../lib/governanceApi';

const EVIDENCE_EDGE_KINDS = ['derived_from', 'evidence_for', 'contradicts'] as const;

interface SupportingEvidenceProps {
  supportingObservationIds: string[];
  edgeMutations: EdgeMutation[];
  historyHrefFor?: (entityId: string) => string | undefined;
}

/** supportingObservationIds plus the derived_from / evidence_for / contradicts edges the mutation itself creates. */
export function SupportingEvidence({ supportingObservationIds, edgeMutations, historyHrefFor }: SupportingEvidenceProps) {
  const evidenceEdges = edgeMutations.filter((m): m is Extract<EdgeMutation, { op: 'create' }> => m.op === 'create' && (EVIDENCE_EDGE_KINDS as readonly string[]).includes(m.kind));

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-xs font-medium text-slate-500 mb-1">Supporting observations</div>
        {supportingObservationIds.length === 0 ? (
          <p className="text-slate-500">None</p>
        ) : (
          <ul className="space-y-1">
            {supportingObservationIds.map((id) => (
              <li key={id} className="flex items-center gap-2">
                <span className="font-mono text-xs text-sky-400">{id}</span>
                {historyHrefFor?.(id) && (
                  <a href={historyHrefFor(id)} className="text-xs text-sky-400 hover:text-sky-300 underline">
                    history
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-slate-500 mb-1">Evidence relationships</div>
        {evidenceEdges.length === 0 ? (
          <p className="text-slate-500">None</p>
        ) : (
          <ul className="space-y-1">
            {evidenceEdges.map((edge) => (
              <li key={edge.edgeId} className="flex items-center gap-2 font-mono text-xs">
                <Badge variant={edge.kind === 'contradicts' ? 'danger' : 'info'}>{edge.kind}</Badge>
                <span className="text-slate-300">
                  {edge.sourceId} → {edge.targetId}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
