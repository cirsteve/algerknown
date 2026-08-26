import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PrimerSummary } from '../lib/api';
import { AlertBox } from '../components/molecules/AlertBox';

export function PrimerList() {
  const [primers, setPrimers] = useState<PrimerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPrimers().then(setPrimers).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-content-muted">Loading primers…</div>;
  if (error) {
    return (
      <AlertBox variant="error">
        <span className="block break-words">Error: {error}</span>
      </AlertBox>
    );
  }

  return <div className="min-w-0 space-y-6">
    {/* Title and action share a row from `sm`; below that the button goes full
        width so it stays a comfortable tap target at 320px. */}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="min-w-0 text-xl font-bold text-content-strong sm:text-2xl">Primers</h1>
      <Link
        to="/primers/new"
        className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:shrink-0"
      >
        New Primer
      </Link>
    </div>
    {primers.length === 0 ? <p className="text-content-muted">No primers found.</p> :
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {primers.map((primer) => <Link key={primer.id} to={`/primers/${encodeURIComponent(primer.id)}`} className="entry-card min-w-0">
          <h2 className="break-words font-semibold text-content">{primer.topic}</h2>
          <p className="mt-2 truncate text-sm text-content-muted" title={primer.source.path}>{primer.source.path}</p>
          <div className="mt-3 flex flex-wrap gap-2">{(primer.tags ?? []).map((tag) => <span key={tag} className="rounded bg-control px-2 py-1 text-xs text-content">#{tag}</span>)}</div>
        </Link>)}
      </div>}
  </div>;
}
