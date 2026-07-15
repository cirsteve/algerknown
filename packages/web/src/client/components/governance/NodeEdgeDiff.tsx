import { Badge } from '../atoms/Badge';
import type { CanonicalMutation, EdgeMutation, NodeMutation } from '../../lib/governanceApi';

const OP_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  create: 'success',
  update: 'warning',
  delete: 'danger',
  revert: 'info',
};

function nodeSummary(mutation: NodeMutation): string {
  if (mutation.op === 'create') {
    const payload = mutation.payload;
    return typeof payload.description === 'string' ? payload.description : typeof payload.statement === 'string' ? payload.statement : JSON.stringify(payload).slice(0, 80);
  }
  if (mutation.op === 'update') return mutation.payload ? JSON.stringify(mutation.payload).slice(0, 80) : '(confidence only)';
  if (mutation.op === 'delete') return '(deleted)';
  return `revert to ${mutation.targetRevisionId}`;
}

function entityId(mutation: NodeMutation | EdgeMutation): string {
  return 'nodeId' in mutation ? mutation.nodeId : mutation.edgeId;
}

interface NodeEdgeDiffProps {
  mutation: CanonicalMutation;
  historyHrefFor?: (entityId: string) => string | undefined;
}

/** Generic node/edge diff rendered for every proposal regardless of adapter kind. */
export function NodeEdgeDiff({ mutation, historyHrefFor }: NodeEdgeDiffProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-slate-400 mb-2">Node mutations ({mutation.nodeMutations.length})</h3>
        <ul className="space-y-2">
          {mutation.nodeMutations.map((m) => (
            <li key={entityId(m)} className="bg-slate-900/50 rounded p-3 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={OP_VARIANT[m.op]}>{m.op}</Badge>
                {m.op === 'create' && <span className="text-xs text-slate-500">{m.nodeType}</span>}
                <span className="font-mono text-xs text-sky-400">{entityId(m)}</span>
                {historyHrefFor?.(entityId(m)) && (
                  <a href={historyHrefFor(entityId(m))} className="text-xs text-sky-400 hover:text-sky-300 underline">
                    history
                  </a>
                )}
              </div>
              <div className="mt-1 text-slate-200">{nodeSummary(m)}</div>
              {m.op === 'create' && <div className="mt-1 text-xs text-slate-500">confidence: {m.confidence}</div>}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-400 mb-2">Edge mutations ({mutation.edgeMutations.length})</h3>
        {mutation.edgeMutations.length === 0 ? (
          <p className="text-sm text-slate-500">None</p>
        ) : (
          <ul className="space-y-2">
            {mutation.edgeMutations.map((m) => (
              <li key={entityId(m)} className="bg-slate-900/50 rounded p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={OP_VARIANT[m.op]}>{m.op}</Badge>
                  {'kind' in m && <Badge variant="info">{m.kind}</Badge>}
                  <span className="font-mono text-xs text-sky-400">{entityId(m)}</span>
                </div>
                {m.op === 'create' && (
                  <div className="mt-1 text-xs text-slate-400 font-mono">
                    {m.sourceId} → {m.targetId}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
