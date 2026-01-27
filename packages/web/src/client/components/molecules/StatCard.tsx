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
    card: 'bg-slate-800',
    value: 'text-slate-100',
    label: 'text-slate-400',
  },
  primary: {
    card: 'bg-sky-900/30 border border-sky-800',
    value: 'text-sky-400',
    label: 'text-sky-300',
  },
  success: {
    card: 'bg-green-900/30 border border-green-800',
    value: 'text-green-400',
    label: 'text-green-300',
  },
  warning: {
    card: 'bg-yellow-900/30 border border-yellow-800',
    value: 'text-yellow-400',
    label: 'text-yellow-300',
  },
  danger: {
    card: 'bg-red-900/30 border border-red-800',
    value: 'text-red-400',
    label: 'text-red-300',
  },
  info: {
    card: 'bg-blue-900/30 border border-blue-800',
    value: 'text-blue-400',
    label: 'text-blue-300',
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
    return <Link to={to}>{content}</Link>;
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
