import type { CanonicalMutation, NodeMutation } from '../../../lib/governanceApi';

type CreateNode = Extract<NodeMutation, { op: 'create' }>;

function createNodes(mutation: CanonicalMutation): CreateNode[] {
  return mutation.nodeMutations.filter((m): m is CreateNode => m.op === 'create');
}

function recordKind(node: CreateNode): string | undefined {
  const context = node.payload.context;
  return context && typeof context === 'object' ? (context as Record<string, unknown>).recordKind as string | undefined : undefined;
}

interface SummaryRendererProps {
  mutation: CanonicalMutation;
}

/**
 * Presents a memory.* (RAG pipeline) proposal the way the original Ingest &
 * Review UI presented it -- learnings, decisions, open questions, links --
 * by reconstructing those groupings from payload.context.recordKind, the
 * same convention buildCandidateProposeInput uses to encode them generically
 * (see packages/web/src/server/governance/candidate-mapping.ts). This is
 * pure presentation: the underlying JSON Patch amendment still targets the
 * generic nodeMutations/edgeMutations arrays.
 */
export function SummaryRenderer({ mutation }: SummaryRendererProps) {
  const nodes = createNodes(mutation);
  const learnings = nodes.filter((n) => recordKind(n) === 'learning');
  const decisions = nodes.filter((n) => n.nodeType === 'decision');
  const openQuestions = nodes.filter((n) => recordKind(n) === 'open_question');
  const links = nodes.filter((n) => recordKind(n) === 'link');

  if (learnings.length === 0 && decisions.length === 0 && openQuestions.length === 0 && links.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {learnings.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-slate-500 mb-1">New learnings</h3>
          <div className="space-y-1">
            {learnings.map((n) => (
              <div key={n.nodeId} className="text-sm bg-slate-900/50 rounded p-2">
                <div className="text-slate-200">{String(n.payload.description ?? '')}</div>
                {typeof (n.payload.context as Record<string, unknown> | undefined)?.context === 'string' && (
                  <div className="text-xs text-slate-500 mt-1">{String((n.payload.context as Record<string, unknown>).context)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {decisions.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-slate-500 mb-1">New decisions</h3>
          <div className="space-y-1">
            {decisions.map((n) => (
              <div key={n.nodeId} className="text-sm bg-slate-900/50 rounded p-2">
                <div className="text-slate-200">{String(n.payload.statement ?? '')}</div>
                {typeof n.payload.rationale === 'string' && <div className="text-xs text-slate-500 mt-1">{n.payload.rationale}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {openQuestions.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-slate-500 mb-1">New open questions</h3>
          <ul className="space-y-1">
            {openQuestions.map((n) => (
              <li key={n.nodeId} className="text-sm text-slate-300 bg-slate-900/50 rounded p-2">
                {String(n.payload.description ?? '')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {links.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-slate-500 mb-1">New links</h3>
          <ul className="space-y-1">
            {links.map((n) => {
              const context = n.payload.context as Record<string, unknown> | undefined;
              return (
                <li key={n.nodeId} className="text-sm text-slate-300">
                  → {String(context?.targetEntryId ?? '?')} ({String(context?.relationship ?? '')})
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
