import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, SearchResult } from '../lib/api';

export function Search() {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'summary' | 'entry' | ''>('');
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-100">Search</h1>

      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex gap-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entries..."
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-sky-500"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'summary' | 'entry' | '')}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value="">All Types</option>
            <option value="summary">Summaries</option>
            <option value="entry">Entries</option>
          </select>
          <button
            type="submit"
            disabled={loading}
            className="bg-sky-500 hover:bg-sky-400 disabled:bg-slate-600 px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {searched && (
        <div className="text-sm text-slate-400">
          {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
        </div>
      )}

      <div className="space-y-4">
        {results.map(result => (
          <Link
            key={result.id}
            to={`/entries/${result.id}`}
            className="block bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-medium text-slate-100">{result.topic}</h3>
                <p className="text-sm text-slate-400 mt-1">{result.id}</p>
                {result.snippet && (
                  <p className="text-sm text-slate-500 mt-2 line-clamp-2">
                    {result.snippet}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4">
                <span className={`entry-type-badge ${
                  result.type === 'summary' 
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'bg-green-500/20 text-green-300'
                }`}>
                  {result.type}
                </span>
                <span className="text-xs text-slate-500">
                  {Math.round(result.score * 100)}%
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {searched && results.length === 0 && !loading && (
        <div className="text-center text-slate-400 py-8">
          No results found for "{query}"
        </div>
      )}
    </div>
  );
}
