import { ReactNode } from 'react';

type IconName = 
  | 'dashboard' 
  | 'entries' 
  | 'search' 
  | 'graph' 
  | 'ask' 
  | 'ingest' 
  | 'changes'
  | 'edit'
  | 'delete'
  | 'add'
  | 'back'
  | 'settings'
  | 'check'
  | 'close'
  | 'chevronRight'
  | 'chevronDown';

interface IconProps {
  name: IconName;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

// Using emoji icons for simplicity - can be replaced with SVG icons
const emojiIcons: Record<IconName, string> = {
  dashboard: '📊',
  entries: '📝',
  search: '🔍',
  graph: '🕸️',
  ask: '💬',
  ingest: '📥',
  changes: '📜',
  edit: '✏️',
  delete: '🗑️',
  add: '➕',
  back: '←',
  settings: '⚙️',
  check: '✓',
  close: '✕',
  chevronRight: '›',
  chevronDown: '˯',
};

const sizeStyles = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

/**
 * Icon atom - Renders an icon by name
 */
export function Icon({ name, size = 'md', className = '' }: IconProps) {
  return (
    <span 
      className={`inline-flex items-center justify-center ${sizeStyles[size]} ${className}`}
      role="img" 
      aria-label={name}
    >
      {emojiIcons[name]}
    </span>
  );
}

interface IconWrapperProps {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * IconWrapper atom - Wraps custom icons/emojis with consistent sizing
 */
export function IconWrapper({ children, size = 'md', className = '' }: IconWrapperProps) {
  return (
    <span className={`inline-flex items-center justify-center ${sizeStyles[size]} ${className}`}>
      {children}
    </span>
  );
}
