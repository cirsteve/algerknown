import { ReactNode, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { NavItem, NavGroup } from '../molecules/NavItem';
import { StatusIndicator } from '../atoms/StatusIndicator';
import { checkRagConnection, getRagApiUrl, setRagApiUrl } from '../../lib/ragApi';
import { Input } from '../atoms/Input';
import { Button } from '../atoms/Button';

interface NavItemConfig {
  path: string;
  label: string;
  icon: ReactNode;
  requiresRag?: boolean;
}

interface SidebarProps {
  navItems: NavItemConfig[];
  className?: string;
}

/**
 * Sidebar organism - Main navigation sidebar
 * 
 * Composed of: NavItem, NavGroup, StatusIndicator, branding
 */
export function Sidebar({ navItems, className = '' }: SidebarProps) {
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);
  const [documentsIndexed, setDocumentsIndexed] = useState<number>(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState(getRagApiUrl());
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);

  const checkConnection = async () => {
    setChecking(true);
    const result = await checkRagConnection();
    setRagConnected(result.connected);
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

  const connectionStatus = checking 
    ? 'checking' 
    : ragConnected === null 
      ? 'unknown' 
      : ragConnected 
        ? 'online' 
        : 'offline';

  return (
    <aside className={`w-64 bg-slate-800 border-r border-slate-700 flex flex-col ${className}`}>
      {/* Branding */}
      <div className="p-4 border-b border-slate-700">
        <Link to="/" className="block">
          <h1 className="text-xl font-bold text-sky-400">Algerknown</h1>
          <p className="text-xs text-slate-400 mt-1">Knowledge Base</p>
        </Link>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <NavGroup>
          {navItems.map(item => (
            <li key={item.path}>
              <NavItem
                to={item.path}
                icon={item.icon}
                label={item.label}
                disabled={item.requiresRag && !ragConnected}
                disabledReason={item.requiresRag ? 'RAG backend offline' : undefined}
              />
            </li>
          ))}
        </NavGroup>
      </nav>
      
      {/* RAG Status Footer */}
      <div className="p-4 border-t border-slate-700 relative">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm hover:bg-slate-700 transition-colors"
        >
          <StatusIndicator status={connectionStatus} />
          <span className="text-slate-400 flex-1 text-left">
            {checking
              ? 'Checking...'
              : ragConnected === null
                ? 'RAG Unknown'
                : ragConnected
                  ? `RAG (${documentsIndexed} docs)`
                  : 'RAG Offline'}
          </span>
          <span className="text-slate-500">⚙️</span>
        </button>

        {settingsOpen && (
          <div className="absolute left-4 right-4 bottom-full mb-2 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 z-50">
            <h3 className="font-medium text-slate-200 mb-3">RAG Backend Settings</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  API URL
                </label>
                <Input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://localhost:8000"
                  inputSize="sm"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleSaveUrl}
                  size="sm"
                  className="flex-1"
                >
                  Save & Reconnect
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSettingsOpen(false)}
                >
                  Cancel
                </Button>
              </div>

              <div className="text-xs text-slate-500">
                Current: {getRagApiUrl()}
              </div>
            </div>
          </div>
        )}
        
        <div className="text-xs text-slate-500 mt-2 px-3">
          YAML-first knowledge base
        </div>
      </div>
    </aside>
  );
}
