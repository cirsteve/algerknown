import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SearchResult } from '../lib/api';
import { Badge } from '../components/atoms/Badge';

const typeVariant: Record<string, 'info' | 'primary' | 'success'> = {
  summary: 'info',
  primer: 'primary',
};

export function Search() {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'summary' | 'entry' | 'primer' | ''>('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const type = typeFilter || undefined;
      const data = await api.search(query, type);
      setResults(data);
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const fieldStyles =
    'w-full rounded-lg border border-edge bg-surface-raised text-content transition-colors placeholder:text-content-subtle hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40';

  return (
    <div className="min-w-0 space-y-6">
      <h1 className="text-xl font-bold text-content-strong sm:text-2xl">Search</h1>

      {/* Query, filter and submit only fit one row from `sm`; below that they
          stack full width so the submit button stays reachable at 320px. */}
      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entries..."
            aria-label="Search query"
            className={`${fieldStyles} px-4 py-3 sm:flex-1`}
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'summary' | 'entry' | 'primer' | '')}
            aria-label="Filter by type"
            className={`${fieldStyles} px-3 py-2 sm:w-auto`}
          >
            <option value="">All Types</option>
            <option value="summary">Summaries</option>
            <option value="entry">Entries</option>
            <option value="primer">Primers</option>
          </select>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-accent px-6 py-3 font-medium text-accent-fg transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:bg-control disabled:text-content-subtle sm:shrink-0"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {searched && (
        <div className="break-words text-sm text-content-muted">
          {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
        </div>
      )}

      <div className="space-y-4">
        {results.map(result => (
          <Link
            key={result.id}
            to={result.type === 'primer' ? `/primers/${encodeURIComponent(result.id)}` : `/entries/${encodeURIComponent(result.id)}`}
            className="block min-w-0 rounded-lg border border-edge bg-surface-raised p-4 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {/* Badge and score move under the text at 320px rather than
                squeezing the topic into a couple of characters. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="break-words font-medium text-content">{result.topic}</h3>
                <p className="mt-1 break-all text-sm text-content-muted">{result.id}</p>
                {result.snippet && (
                  <p className="mt-2 line-clamp-2 break-words text-sm text-content-subtle">
                    {result.snippet}
                  </p>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2 sm:ml-4">
                <Badge variant={typeVariant[result.type] ?? 'success'}>{result.type}</Badge>
                <span className="text-xs text-content-subtle">
                  {Math.round(result.score * 100)}%
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {searched && results.length === 0 && !loading && (
        <div className="break-words py-8 text-center text-content-muted">
          No results found for "{query}"
        </div>
      )}
    </div>
  );
}
