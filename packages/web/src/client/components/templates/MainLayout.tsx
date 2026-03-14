import { ReactNode } from 'react';
import { Sidebar } from '../organisms/Sidebar';

interface MainLayoutProps {
  children: ReactNode;
}

/**
 * MainLayout template - Primary application layout with sidebar
 * 
 * This is the main structural template used across all pages.
 * It provides the sidebar navigation and main content area.
 */
export function MainLayout({ children }: MainLayoutProps) {
  const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊', requiresRag: false },
    { path: '/entries', label: 'Entries', icon: '📝', requiresRag: false },
    { path: '/summaries/new', label: 'New Summary', icon: '📋', requiresRag: true },
    { path: '/search', label: 'Search', icon: '🔍', requiresRag: false },
    { path: '/graph', label: 'Graph', icon: '🕸️', requiresRag: false },
    { path: '/ask', label: 'Ask', icon: '💬', requiresRag: true },
    { path: '/ingest', label: 'Ingest', icon: '📥', requiresRag: true },
    { path: '/changes', label: 'Changes', icon: '📜', requiresRag: true },
  ];

  return (
    <div className="min-h-screen flex">
      <Sidebar navItems={navItems} />
      <main className="flex-1 p-8 overflow-auto">
        {children}
      </main>
    </div>
  );
}
