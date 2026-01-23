import { useState, useEffect } from 'react';
import { getRagApiUrl, setRagApiUrl, checkRagConnection } from '../lib/ragApi';

interface RagStatusProps {
  showSettings?: boolean;
}

export function RagStatus({ showSettings = false }: RagStatusProps) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [documentsIndexed, setDocumentsIndexed] = useState<number>(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState(getRagApiUrl());
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setChecking(true);
    const result = await checkRagConnection();
    setConnected(result.connected);
    if (result.status) {
      setDocumentsIndexed(result.status.documents_indexed);
    }
    setChecking(false);
  };

  const handleSaveUrl = () => {
    setRagApiUrl(apiUrl);
    setSettingsOpen(false);
    checkConnection();
  };

  return (
    <div className="relative">
      <button
        onClick={() => showSettings && setSettingsOpen(!settingsOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
          showSettings ? 'hover:bg-slate-700 cursor-pointer' : 'cursor-default'
        }`}
      >
        <div
          className={`w-2 h-2 rounded-full ${
            checking
              ? 'bg-yellow-500 animate-pulse'
              : connected === null
              ? 'bg-yellow-500'
              : connected
              ? 'bg-green-500'
              : 'bg-red-500'
          }`}
        />
        <span className="text-slate-400">
          {checking
            ? 'Checking...'
            : connected === null
            ? 'RAG Unknown'
            : connected
            ? `RAG (${documentsIndexed} docs)`
            : 'RAG Offline'}
        </span>
        {showSettings && (
          <span className="text-slate-500">⚙️</span>
        )}
      </button>

      {settingsOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 z-50">
          <h3 className="font-medium text-slate-200 mb-3">RAG Backend Settings</h3>
          
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                API URL
              </label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:8000"
                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveUrl}
                className="flex-1 bg-sky-500 hover:bg-sky-400 px-3 py-2 rounded text-sm font-medium"
              >
                Save & Reconnect
              </button>
              <button
                onClick={() => setSettingsOpen(false)}
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm"
              >
                Cancel
              </button>
            </div>

            <div className="text-xs text-slate-500">
              Current: {getRagApiUrl()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
