import { ReactNode } from 'react';

type AlertVariant = 'info' | 'success' | 'warning' | 'error';

interface AlertBoxProps {
  children: ReactNode;
  variant?: AlertVariant;
  title?: string;
  className?: string;
  dismissable?: boolean;
  onDismiss?: () => void;
}

const variantStyles: Record<AlertVariant, { box: string; title: string }> = {
  info: {
    box: 'bg-blue-900/30 border border-blue-700 text-blue-300',
    title: 'text-blue-200',
  },
  success: {
    box: 'bg-green-900/30 border border-green-700 text-green-300',
    title: 'text-green-200',
  },
  warning: {
    box: 'bg-yellow-900/30 border border-yellow-700 text-yellow-300',
    title: 'text-yellow-200',
  },
  error: {
    box: 'bg-red-900/30 border border-red-700 text-red-300',
    title: 'text-red-200',
  },
};

/**
 * AlertBox molecule - Displays a message with semantic styling
 */
export function AlertBox({ 
  children, 
  variant = 'info', 
  title,
  className = '',
  dismissable = false,
  onDismiss,
}: AlertBoxProps) {
  const styles = variantStyles[variant];

  return (
    <div className={`rounded-lg p-4 ${styles.box} ${className}`} role="alert">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {title && (
            <h3 className={`font-medium mb-1 ${styles.title}`}>{title}</h3>
          )}
          <div className="text-sm">{children}</div>
        </div>
        {dismissable && onDismiss && (
          <button
            onClick={onDismiss}
            className="ml-4 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  message: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * EmptyState molecule - Displayed when there's no content
 */
export function EmptyState({ 
  message, 
  description,
  icon,
  action,
  className = '' 
}: EmptyStateProps) {
  return (
    <div className={`text-center py-12 ${className}`}>
      {icon && <div className="text-4xl mb-4 opacity-50">{icon}</div>}
      <h3 className="text-lg font-medium text-slate-300">{message}</h3>
      {description && (
        <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
