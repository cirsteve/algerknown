import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PrimerSummary } from '../lib/api';

export function PrimerList() {
  const [primers, setPrimers] = useState<PrimerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPrimers().then(setPrimers).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400">Loading primers…</div>;
  if (error) return <div className="rounded-lg bg-red-500/20 p-4 text-red-300">Error: {error}</div>;

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold text-slate-100">Primers</h1>
    {primers.length === 0 ? <p className="text-slate-400">No primers found.</p> :
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {primers.map((primer) => <Link key={primer.id} to={`/primers/${primer.id}`} className="entry-card block">
          <h2 className="font-semibold text-slate-100">{primer.topic}</h2>
          <p className="mt-2 truncate text-sm text-slate-400">{primer.source.path}</p>
          <div className="mt-3 flex flex-wrap gap-2">{primer.tags.map((tag) => <span key={tag} className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300">#{tag}</span>)}</div>
        </Link>)}
      </div>}
  </div>;
}
