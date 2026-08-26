import { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

const variantStyles = {
  default: 'bg-control text-content',
  primary: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  success: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
};

const sizeStyles = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-xs px-2 py-1',
};

/**
 * Badge atom - A small label for categorization or status
 */
export function Badge({ 
  children, 
  variant = 'default', 
  size = 'md',
  className = '' 
}: BadgeProps) {
  return (
    <span 
      className={`inline-flex items-center rounded-full font-medium ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </span>
  );
}

interface TypeBadgeProps {
  type: 'summary' | 'entry' | string;
  className?: string;
}

/**
 * TypeBadge atom - Specialized badge for entry types
 */
export function TypeBadge({ type, className = '' }: TypeBadgeProps) {
  const variant = type === 'summary' ? 'info' : 'success';
  return (
    <Badge variant={variant} className={className}>
      {type}
    </Badge>
  );
}

interface StatusBadgeProps {
  status: 'active' | 'archived' | 'draft' | string;
  className?: string;
}

/**
 * StatusBadge atom - Specialized badge for entry statuses
 */
export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const variantMap: Record<string, BadgeProps['variant']> = {
    active: 'success',
    archived: 'default',
    draft: 'warning',
  };
  const variant = variantMap[status] || 'default';
  
  return (
    <Badge variant={variant} size="sm" className={className}>
      {status}
    </Badge>
  );
}
