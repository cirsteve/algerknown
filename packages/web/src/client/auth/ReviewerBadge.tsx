import { useGovernanceAuth } from './GovernanceAuthContext';

/** Small fixed badge showing the authenticated reviewer, with a logout action. */
export function ReviewerBadge() {
  const { status, reviewer, logout } = useGovernanceAuth();

  if (status !== 'unlocked' || !reviewer) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-full border border-slate-700 bg-slate-800/90 px-4 py-2 text-sm text-slate-200 shadow-lg backdrop-blur">
      <span>
        Reviewing as <span className="font-medium text-slate-100">{reviewer.displayName}</span>
      </span>
      <button type="button" onClick={() => logout()} className="text-sky-400 hover:text-sky-300">
        Lock
      </button>
    </div>
  );
}
