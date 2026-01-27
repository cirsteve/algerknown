import { ReactNode } from 'react';

interface TabProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Tab molecule - Individual tab button
 */
export function Tab({ active, onClick, children, className = '' }: TabProps) {
  return (
    <button
      onClick={onClick}
      className={`
        px-4 py-2 text-sm font-medium transition-colors
        ${active 
          ? 'text-sky-400 border-b-2 border-sky-400' 
          : 'text-slate-400 hover:text-slate-200 border-b-2 border-transparent'
        }
        ${className}
      `}
    >
      {children}
    </button>
  );
}

interface TabBarProps {
  children: ReactNode;
  className?: string;
}

/**
 * TabBar molecule - Container for Tab components
 */
export function TabBar({ children, className = '' }: TabBarProps) {
  return (
    <div className={`flex border-b border-slate-700 ${className}`}>
      {children}
    </div>
  );
}

interface TabPanelProps {
  active: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * TabPanel molecule - Content panel for a tab
 */
export function TabPanel({ active, children, className = '' }: TabPanelProps) {
  if (!active) return null;
  return <div className={className}>{children}</div>;
}
