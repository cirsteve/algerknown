import type { CanonicalMutation, NodeMutation } from '../../../lib/governanceApi';

type CreateNode = Extract<NodeMutation, { op: 'create' }>;

function createNodes(mutation: CanonicalMutation): CreateNode[] {
  return mutation.nodeMutations.filter((m): m is CreateNode => m.op === 'create');
}

interface DossierRendererProps {
  mutation: CanonicalMutation;
}

/**
 * Presents a canonical.* (git-backed Algerknown dossier) proposal using the
 * dossier's own vocabulary -- facts, resources, prohibitions, evidence --
 * from the generic node payloads (see @algerknown/governed's FactPayload /
 * ResourcePayload / ProhibitionPayload). Pure presentation over the same
 * generic nodeMutations the amendment editor operates on.
 */
export function DossierRenderer({ mutation }: DossierRendererProps) {
  const nodes = createNodes(mutation);
  const facts = nodes.filter((n) => n.nodeType === 'fact');
  const resources = nodes.filter((n) => n.nodeType === 'resource');
  const prohibitions = nodes.filter((n) => n.nodeType === 'prohibition');
  const evidence = nodes.filter((n) => n.nodeType === 'observation');

  if (facts.length === 0 && resources.length === 0 && prohibitions.length === 0 && evidence.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {facts.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-slate-500 mb-1">Facts</h3>
          <ul className="space-y-1">
            {facts.map((n) => (
              <li key={n.nodeId} className="text-sm text-slate-200 bg-slate-900/50 rounded p-2">
                {String(n.payload.statement ?? '')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {resources.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-slate-500 mb-1">Resources</h3>
          <ul className="space-y-1">
            {resources.map((n) => (
              <li key={n.nodeId} className="text-sm text-slate-200 bg-slate-900/50 rounded p-2">
                {String(n.payload.label ?? n.payload.locator ?? '')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {prohibitions.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-slate-500 mb-1">Prohibitions</h3>
          <ul className="space-y-1">
            {prohibitions.map((n) => (
              <li key={n.nodeId} className="text-sm text-slate-200 bg-slate-900/50 rounded p-2">
                {String(n.payload.rule ?? '')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {evidence.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-slate-500 mb-1">Evidence</h3>
          <ul className="space-y-1">
            {evidence.map((n) => (
              <li key={n.nodeId} className="text-sm text-slate-300 bg-slate-900/50 rounded p-2">
                {String(n.payload.description ?? '')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
