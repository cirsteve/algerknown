import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type Primer, type PrimerSource } from '../lib/api';
import { AlertBox } from '../components/molecules/AlertBox';

/*
 * `.primer-markdown` styles code blocks with their own `overflow-x-auto`, but a
 * GFM table has no such escape - a handful of columns is wider than 320px on its
 * own. Wrapping every table in a scroll region keeps the document from growing
 * while leaving the table's own alignment intact.
 */
const markdownComponents = {
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-5 overflow-x-auto rounded-lg border border-edge">
      {/* `!my-0` overrides the stylesheet's own table margin, which would
          otherwise show up as padding inside the scroll box. */}
      <table className="!my-0 min-w-[28rem]">{children}</table>
    </div>
  ),
};

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

  if (error) {
    return (
      <AlertBox variant="error">
        <span className="block break-words">Error: {error}</span>
      </AlertBox>
    );
  }
  if (!primer || !source) return <div className="text-content-muted">Loading primer…</div>;

  return <div className="mx-auto min-w-0 max-w-5xl space-y-6">
    <header className="min-w-0">
      <Link
        to="/primers"
        className="rounded-sm text-link transition-colors hover:text-link-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ← Back to primers
      </Link>
      <h1 className="mt-2 break-words text-2xl font-bold text-content-strong sm:text-3xl">{primer.topic}</h1>
      <p className="mt-2 break-all text-sm text-content-muted">{source.path}</p>
      <p className="mt-1 text-xs text-content-subtle">Updated {new Date(source.mtime).toLocaleString()}</p>
    </header>
    <article className="primer-markdown min-w-0 rounded-lg border border-edge bg-surface-raised p-4 sm:p-6 md:p-10">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{source.content}</ReactMarkdown>
    </article>
  </div>;
}
