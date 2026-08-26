import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, IndexEntryRef } from '../lib/api';
import { EntryCard } from '../components/EntryCard';
import { AlertBox } from '../components/molecules/AlertBox';

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

  const filteredEntries = useMemo(
    () => selectedType ? entries.filter(e => e.type === selectedType) : entries,
    [entries, selectedType]
  );

  const summaryEntries = useMemo(() => {
    if (selectedType === 'summary') return filteredEntries;
    if (selectedType === 'entry') return [];
    return filteredEntries.filter(e => e.type === 'summary');
  }, [filteredEntries, selectedType]);

  const journalEntries = useMemo(() => {
    if (selectedType === 'entry') return filteredEntries;
    if (selectedType === 'summary') return [];
    return filteredEntries.filter(e => e.type === 'entry');
  }, [filteredEntries, selectedType]);

  if (loading) {
    return <div className="text-content-muted">Loading...</div>;
  }

  if (error) {
    return (
      <AlertBox variant="error">
        <span className="block break-words">Error: {error}</span>
      </AlertBox>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* The action pair needs about 24rem beside the title, so it only shares
          the row from `sm`. Below that both controls go full width. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 text-xl font-bold text-content-strong sm:text-2xl">Entries</h1>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link
            to="/entries/new"
            className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            + New Entry
          </Link>
          <select
            aria-label="Filter by type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full rounded-lg border border-edge bg-surface-raised px-3 py-2 text-content transition-colors hover:border-edge-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 sm:w-auto"
          >
            <option value="">All Types</option>
            <option value="summary">Summaries</option>
            <option value="entry">Entries</option>
          </select>
        </div>
      </div>

      <div className="text-sm text-content-muted">
        Showing {filteredEntries.length} of {entries.length} entries
      </div>

      {summaryEntries.length > 0 && (
        <section className="min-w-0 space-y-4">
          <h2 className="text-lg font-semibold text-content-strong sm:text-xl">Summaries</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {summaryEntries.map(entry => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {journalEntries.length > 0 && (
        <section className="min-w-0 space-y-4">
          <h2 className="text-lg font-semibold text-content-strong sm:text-xl">Journal Entries</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {journalEntries.map(entry => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {filteredEntries.length === 0 && (
        <div className="py-8 text-center text-content-muted">
          No entries found
        </div>
      )}
    </div>
  );
}
