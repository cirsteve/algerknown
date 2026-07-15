import type { DurableProposalStatus } from '../../lib/governanceApi';

const STATUS_TABS: { key: DurableProposalStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'expired', label: 'Expired' },
];

interface ProposalFiltersProps {
  status: DurableProposalStatus;
  onStatusChange: (status: DurableProposalStatus) => void;
  namespace: string;
  onNamespaceChange: (namespace: string) => void;
  namespaceOptions: string[];
}

/** Status tabs + namespace filter, populated from proposals the queue has actually returned. */
export function ProposalFilters({ status, onStatusChange, namespace, onNamespaceChange, namespaceOptions }: ProposalFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 w-fit" role="tablist" aria-label="Proposal status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={status === tab.key}
            onClick={() => onStatusChange(tab.key)}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
              status === tab.key ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="governance-namespace-filter" className="text-sm text-slate-400">
          Namespace:
        </label>
        <select
          id="governance-namespace-filter"
          value={namespace}
          onChange={(e) => onNamespaceChange(e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded px-3 py-1 text-sm text-slate-100"
        >
          <option value="">All namespaces</option>
          {namespaceOptions.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
