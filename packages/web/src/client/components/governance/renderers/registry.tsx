import type { CanonicalMutation } from '../../../lib/governanceApi';
import { SummaryRenderer } from './SummaryRenderer';
import { DossierRenderer } from './DossierRenderer';

export type ProposalAdapterKind = 'summary' | 'dossier' | 'generic';

/**
 * The API does not (yet) publish an explicit adapter-kind field on proposal
 * detail, so the adapter kind is derived from the one namespace-shape signal
 * the server does send: targetNamespace. memory.* namespaces hold the RAG
 * pipeline's learnings/decisions/open-questions/links (see
 * candidate-mapping.ts); canonical.* namespaces hold the git-backed dossier's
 * facts/resources/prohibitions. Both renderers are presentation-only layers
 * over the same generic WriteCommand -- NodeEdgeDiff is always rendered
 * alongside them, never replaced by them.
 */
export function resolveAdapterKind(namespace: string): ProposalAdapterKind {
  if (namespace.startsWith('memory.')) return 'summary';
  if (namespace.startsWith('canonical.')) return 'dossier';
  return 'generic';
}

interface ProposalRendererProps {
  namespace: string;
  mutation: CanonicalMutation;
}

/** Registry entry point: renders the specialized adapter for this proposal's namespace, or nothing for a generic namespace. */
export function ProposalRenderer({ namespace, mutation }: ProposalRendererProps) {
  const kind = resolveAdapterKind(namespace);
  if (kind === 'summary') return <SummaryRenderer mutation={mutation} />;
  if (kind === 'dossier') return <DossierRenderer mutation={mutation} />;
  return null;
}
