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
        px-4 py-2 text-sm font-medium transition-colors rounded-t
        focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent
        disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none
        ${active 
          ? 'text-link border-b-2 border-link' 
          : 'text-content-muted hover:text-content hover:border-edge-strong border-b-2 border-transparent'
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
    <div className={`flex border-b border-edge ${className}`}>
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
