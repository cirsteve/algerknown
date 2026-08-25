import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface StatCardProps {
  value: number | string;
  label: string;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
  to?: string;
  className?: string;
  icon?: ReactNode;
}

const variantStyles = {
  default: {
    card: 'bg-surface-raised border border-edge',
    value: 'text-content-strong',
    label: 'text-content-muted',
  },
  primary: {
    card: 'bg-sky-50 border border-sky-200 dark:bg-sky-900/30 dark:border-sky-800',
    value: 'text-sky-800 dark:text-sky-300',
    label: 'text-sky-700 dark:text-sky-400',
  },
  success: {
    card: 'bg-green-50 border border-green-200 dark:bg-green-900/30 dark:border-green-800',
    value: 'text-green-800 dark:text-green-300',
    label: 'text-green-700 dark:text-green-400',
  },
  warning: {
    card: 'bg-yellow-50 border border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-800',
    value: 'text-yellow-800 dark:text-yellow-300',
    label: 'text-yellow-700 dark:text-yellow-400',
  },
  danger: {
    card: 'bg-red-50 border border-red-200 dark:bg-red-900/30 dark:border-red-800',
    value: 'text-red-800 dark:text-red-300',
    label: 'text-red-700 dark:text-red-400',
  },
  info: {
    card: 'bg-blue-50 border border-blue-200 dark:bg-blue-900/30 dark:border-blue-800',
    value: 'text-blue-800 dark:text-blue-300',
    label: 'text-blue-700 dark:text-blue-400',
  },
};

/**
 * StatCard molecule - A card displaying a statistic
 * 
 * Optionally linkable for navigation
 */
export function StatCard({ 
  value, 
  label, 
  variant = 'default',
  to,
  icon,
  className = '' 
}: StatCardProps) {
  const styles = variantStyles[variant];
  
  const content = (
    <div className={`rounded-lg p-4 ${styles.card} ${to ? 'hover:opacity-80 transition-opacity' : ''} ${className}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className={`text-2xl font-bold ${styles.value}`}>{value}</div>
          <div className={`text-sm mt-1 ${styles.label}`}>{label}</div>
        </div>
        {icon && <div className="text-2xl opacity-50">{icon}</div>}
      </div>
    </div>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        {content}
      </Link>
    );
  }

  return content;
}

interface StatGridProps {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

/**
 * StatGrid molecule - Grid layout for StatCards
 */
export function StatGrid({ children, columns = 3, className = '' }: StatGridProps) {
  const colStyles = {
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
  };

  return (
    <div className={`grid ${colStyles[columns]} gap-4 ${className}`}>
      {children}
    </div>
  );
}
