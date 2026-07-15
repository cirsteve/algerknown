import { Badge } from '../atoms/Badge';
import type { Provenance } from '../../lib/governanceApi';

interface ProvenancePanelProps {
  provenance: Provenance;
  mutationHash: string;
  fingerprint: string;
}

/** Source provenance and immutable references: processor, rail, sources, mutation identity. */
export function ProvenancePanel({ provenance, mutationHash, fingerprint }: ProvenancePanelProps) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">rail: {provenance.railId}</Badge>
        {provenance.processorId && <Badge variant="default">processor: {provenance.processorId}</Badge>}
        {provenance.processorVersion && <span className="text-xs text-slate-500">v{provenance.processorVersion}</span>}
        {provenance.sourceDerived && <Badge variant="default">source-derived</Badge>}
      </div>

      <div>
        <div className="text-xs font-medium text-slate-500 mb-1">Sources</div>
        {provenance.sources.length === 0 ? (
          <p className="text-slate-500">None recorded</p>
        ) : (
          <ul className="space-y-1">
            {provenance.sources.map((source, i) => (
              <li key={i} className="font-mono text-xs text-slate-300">
                [{source.kind}] {source.id}
                {source.locator && <span className="text-slate-500"> — {source.locator}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
        <div>
          Mutation hash: <span className="font-mono text-slate-400">{mutationHash}</span>
        </div>
        <div>
          Fingerprint: <span className="font-mono text-slate-400">{fingerprint}</span>
        </div>
      </div>
    </div>
  );
}
