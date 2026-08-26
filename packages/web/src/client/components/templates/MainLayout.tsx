import { ReactNode } from 'react';
import { Sidebar } from '../organisms/Sidebar';
import { useJobsContext } from '../../context/JobsContext';

interface MainLayoutProps {
  children: ReactNode;
}

/**
 * MainLayout template - Primary application layout with sidebar
 *
 * This is the main structural template used across all pages.
 * It provides the sidebar navigation and main content area.
 *
 * The row only becomes a row at `md`; below that `Sidebar` contributes a sticky
 * header and a drawer instead of a column, so main content gets the full width
 * down to 320px. `min-w-0` keeps a wide child (a table, a long code block) from
 * stretching the flex row into a document-level horizontal scroll.
 */
export function MainLayout({ children }: MainLayoutProps) {
  const { activeCount } = useJobsContext();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊', requiresRag: false },
    { path: '/entries', label: 'Entries', icon: '📝', requiresRag: false },
    { path: '/primers', label: 'Primers', icon: '📖', requiresRag: false },
    { path: '/primers/new', label: 'New Primer', icon: '➕', requiresRag: false },
    { path: '/summaries/new', label: 'New Summary', icon: '📋', requiresRag: false },
    { path: '/search', label: 'Search', icon: '🔍', requiresRag: false },
    { path: '/graph', label: 'Graph', icon: '🕸️', requiresRag: false },
    { path: '/ask', label: 'Ask', icon: '💬', requiresRag: true },
    { path: '/ingest', label: 'Ingest', icon: '📥', requiresRag: true },
    { path: '/changes', label: 'Changes', icon: '📜', requiresRag: true },
    { path: '/jobs', label: 'Jobs', icon: '⚡', requiresRag: true, badge: activeCount },
    { path: '/traces', label: 'Traces', icon: '📡', requiresRag: true },
  ];

  return (
    <div className="min-h-screen supports-[min-height:100dvh]:min-h-[100dvh] md:flex">
      <Sidebar navItems={navItems} />
      <main className="min-w-0 flex-1 overflow-auto p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}
