import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, IndexEntryRef } from '../lib/api';

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
    return <div className="text-slate-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-500/20 text-red-300 p-4 rounded-lg">
        Error: {error}
      </div>
    );
  }

  const summaryCount = entries.filter(e => e.type === 'summary').length;
  const entryCount = entries.filter(e => e.type === 'entry').length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Knowledge Base</h1>
        <p className="text-slate-400 mt-2">Version {config?.version}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800 rounded-lg p-6">
          <div className="text-3xl font-bold text-sky-400">{config?.entryCount || 0}</div>
          <div className="text-slate-400 mt-1">Total Items</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-6">
          <div className="text-3xl font-bold text-blue-400">{summaryCount}</div>
          <div className="text-slate-400 mt-1">Summaries</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-6">
          <div className="text-3xl font-bold text-green-400">{entryCount}</div>
          <div className="text-slate-400 mt-1">Entries</div>
        </div>
      </div>

      {/* Entry Types */}
      <div>
        <h2 className="text-xl font-semibold text-slate-200 mb-4">By Type</h2>
        <div className="grid grid-cols-2 gap-4">
          <Link
            to="/entries?type=summary"
            className="bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors"
          >
            <div className="text-2xl font-bold text-blue-300">{summaryCount}</div>
            <div className="text-slate-400">Summaries</div>
          </Link>
          <Link
            to="/entries?type=entry"
            className="bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors"
          >
            <div className="text-2xl font-bold text-green-300">{entryCount}</div>
            <div className="text-slate-400">Entries</div>
          </Link>
        </div>
      </div>

      {/* Recent */}
      <div>
        <h2 className="text-xl font-semibold text-slate-200 mb-4">Recent Items</h2>
        <div className="space-y-2">
          {entries.slice(0, 5).map(entry => (
            <Link
              key={entry.id}
              to={`/entries/${entry.id}`}
              className="block bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{entry.id}</span>
                <span className={`entry-type-badge ${
                  entry.type === 'summary' 
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'bg-green-500/20 text-green-300'
                }`}>
                  {entry.type}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
