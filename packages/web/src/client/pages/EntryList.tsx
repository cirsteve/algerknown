import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, IndexEntryRef } from '../lib/api';
import { EntryCard } from '../components/EntryCard';

export function EntryList() {
  const [searchParams] = useSearchParams();
  const typeFilter = searchParams.get('type') as 'summary' | 'entry' | null;

  const [entries, setEntries] = useState<IndexEntryRef[]>([]);
  const [selectedType, setSelectedType] = useState<string>(typeFilter || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const entriesData = await api.getEntries();
        setEntries(entriesData);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const filteredEntries = selectedType
    ? entries.filter(e => e.type === selectedType)
    : entries;

  if (loading) {
    return <div className="text-slate-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-500/20 text-red-300 p-4 rounded-lg">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">Entries</h1>
        <div className="flex gap-4">
          <Link
            to="/entries/new"
            className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + New Entry
          </Link>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value="">All Types</option>
            <option value="summary">Summaries</option>
            <option value="entry">Entries</option>
          </select>
        </div>
      </div>

      <div className="text-sm text-slate-400">
        Showing {filteredEntries.length} of {entries.length} entries
      </div>

      {filteredEntries.filter(e => e.type === 'summary').length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-200">Summaries</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEntries.filter(e => e.type === 'summary').map(entry => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {filteredEntries.filter(e => e.type === 'entry').length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-200">Journal Entries</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEntries.filter(e => e.type === 'entry').map(entry => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {filteredEntries.length === 0 && (
        <div className="text-center text-slate-400 py-8">
          No entries found
        </div>
      )}
    </div>
  );
}
