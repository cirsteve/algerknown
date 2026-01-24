import { Link, useLocation } from 'react-router-dom';
import { ReactNode, useState, useEffect } from 'react';
import { RagStatus } from './RagStatus';
import { checkRagConnection } from '../lib/ragApi';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [ragConnected, setRagConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const check = async () => {
      const result = await checkRagConnection();
      setRagConnected(result.connected);
    };
    check();
    // Re-check every 30 seconds
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);
  
  const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊', requiresRag: false },
    { path: '/entries', label: 'Entries', icon: '📝', requiresRag: false },
    { path: '/search', label: 'Search', icon: '🔍', requiresRag: false },
    { path: '/graph', label: 'Graph', icon: '🕸️', requiresRag: false },
    { path: '/ask', label: 'Ask', icon: '💬', requiresRag: true },
    { path: '/ingest', label: 'Ingest', icon: '📥', requiresRag: true },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <h1 className="text-xl font-bold text-sky-400">Algerknown</h1>
          <p className="text-xs text-slate-400 mt-1">Knowledge Base</p>
        </div>
        
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {navItems.map(item => {
              const isDisabled = item.requiresRag && !ragConnected;
              const isActive = location.pathname === item.path;
              
              if (isDisabled) {
                return (
                  <li key={item.path}>
                    <span
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 cursor-not-allowed"
                      title="RAG backend offline"
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </span>
                  </li>
                );
              }
              
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-sky-500/20 text-sky-300'
                        : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        
        <div className="p-4 border-t border-slate-700">
          <RagStatus showSettings />
          <div className="text-xs text-slate-500 mt-2">
            YAML-first knowledge base
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        {children}
      </main>
    </div>
  );
}
