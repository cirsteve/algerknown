import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type Primer, type PrimerSource } from '../lib/api';

export function PrimerDetail() {
  const { id } = useParams<{ id: string }>();
  const [primer, setPrimer] = useState<Primer | null>(null);
  const [source, setSource] = useState<PrimerSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let isActive = true;
    setPrimer(null);
    setSource(null);
    setError(null);

    Promise.all([api.getPrimer(id), api.getPrimerSource(id)])
      .then(([nextPrimer, nextSource]) => {
        if (!isActive) return;
        setPrimer(nextPrimer);
        setSource(nextSource);
      })
      .catch((reason: unknown) => {
        if (isActive) setError(reason instanceof Error ? reason.message : 'Failed to load primer');
      });

    return () => { isActive = false; };
  }, [id]);

  if (error) return <div className="rounded-lg bg-red-500/20 p-4 text-red-300">Error: {error}</div>;
  if (!primer || !source) return <div className="text-slate-400">Loading primer…</div>;

  return <div className="mx-auto max-w-5xl space-y-6">
    <header>
      <Link to="/primers" className="text-sky-400 hover:text-sky-300">← Back to primers</Link>
      <h1 className="mt-2 text-3xl font-bold text-slate-100">{primer.topic}</h1>
      <p className="mt-2 break-all text-sm text-slate-400">{source.path}</p>
      <p className="mt-1 text-xs text-slate-500">Updated {new Date(source.mtime).toLocaleString()}</p>
    </header>
    <article className="primer-markdown rounded-lg bg-slate-800 p-6 md:p-10">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source.content}</ReactMarkdown>
    </article>
  </div>;
}
