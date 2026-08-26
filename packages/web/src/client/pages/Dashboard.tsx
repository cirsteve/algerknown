import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, IndexEntryRef } from '../lib/api';
import { TypeBadge } from '../components/atoms/Badge';
import { AlertBox } from '../components/molecules/AlertBox';

/*
 * Stat tiles are one column at 320px and only spread out from `md`, which is
 * also where the sidebar stops eating width. The two "by type" tiles keep two
 * columns throughout - a count and a one-word label still fit at 160px.
 */
const statCard = 'min-w-0 rounded-lg border border-edge bg-surface-raised p-4 sm:p-6';

export function Dashboard() {
  const [entries, setEntries] = useState<IndexEntryRef[]>([]);
  const [config, setConfig] = useState<{ version: string; entryCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [entriesData, configData] = await Promise.all([
          api.getEntries(),
          api.getConfig(),
        ]);
        setEntries(entriesData);
        setConfig(configData);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

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

  const summaryCount = entries.filter(e => e.type === 'summary').length;
  const entryCount = entries.filter(e => e.type === 'entry').length;

  return (
    <div className="min-w-0 space-y-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-content-strong sm:text-3xl">Knowledge Base</h1>
        <p className="mt-2 break-words text-content-muted">Version {config?.version}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={statCard}>
          <div className="text-3xl font-bold text-sky-700 dark:text-sky-400">{config?.entryCount || 0}</div>
          <div className="mt-1 text-content-muted">Total Items</div>
        </div>
        <div className={statCard}>
          <div className="text-3xl font-bold text-blue-700 dark:text-blue-400">{summaryCount}</div>
          <div className="mt-1 text-content-muted">Summaries</div>
        </div>
        <div className={statCard}>
          <div className="text-3xl font-bold text-green-700 dark:text-green-400">{entryCount}</div>
          <div className="mt-1 text-content-muted">Entries</div>
        </div>
      </div>

      {/* Entry Types */}
      <div className="min-w-0">
        <h2 className="mb-4 text-lg font-semibold text-content-strong sm:text-xl">By Type</h2>
        <div className="grid grid-cols-2 gap-4">
          <Link
            to="/entries?type=summary"
            className="min-w-0 rounded-lg border border-edge bg-surface-raised p-4 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{summaryCount}</div>
            <div className="text-content-muted">Summaries</div>
          </Link>
          <Link
            to="/entries?type=entry"
            className="min-w-0 rounded-lg border border-edge bg-surface-raised p-4 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <div className="text-2xl font-bold text-green-700 dark:text-green-300">{entryCount}</div>
            <div className="text-content-muted">Entries</div>
          </Link>
        </div>
      </div>

      {/* Recent */}
      <div className="min-w-0">
        <h2 className="mb-4 text-lg font-semibold text-content-strong sm:text-xl">Recent Items</h2>
        <div className="space-y-2">
          {entries.slice(0, 5).map(entry => (
            <Link
              key={entry.id}
              to={`/entries/${entry.id}`}
              className="block min-w-0 rounded-lg border border-edge bg-surface-raised p-4 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {/* An id can be long enough to squeeze the badge off the row, so it
                  truncates and the badge refuses to shrink. */}
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium text-content">{entry.id}</span>
                <TypeBadge type={entry.type} className="flex-shrink-0" />
              </div>
            </Link>
          ))}
          {entries.length === 0 && (
            <p className="text-content-muted">No items yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
