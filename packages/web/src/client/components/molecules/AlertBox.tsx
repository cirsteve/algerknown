import { ReactNode } from 'react';

type AlertVariant = 'info' | 'success' | 'warning' | 'error';

interface AlertBoxProps {
  children: ReactNode;
  variant?: AlertVariant;
  title?: string;
  className?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
}

const variantStyles: Record<AlertVariant, { box: string; title: string; focus: string }> = {
  info: {
    box: 'bg-blue-50 border border-blue-300 text-blue-900 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200',
    title: 'text-blue-900 dark:text-blue-100',
    focus: 'focus-visible:ring-blue-500',
  },
  success: {
    box: 'bg-green-50 border border-green-300 text-green-900 dark:bg-green-900/30 dark:border-green-700 dark:text-green-200',
    title: 'text-green-900 dark:text-green-100',
    focus: 'focus-visible:ring-green-500',
  },
  warning: {
    box: 'bg-yellow-50 border border-yellow-400 text-yellow-900 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-200',
    title: 'text-yellow-900 dark:text-yellow-100',
    focus: 'focus-visible:ring-yellow-500',
  },
  error: {
    box: 'bg-red-50 border border-red-300 text-red-900 dark:bg-red-900/30 dark:border-red-700 dark:text-red-200',
    title: 'text-red-900 dark:text-red-100',
    focus: 'focus-visible:ring-red-500',
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
  dismissible = false,
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
        {dismissible && onDismiss && (
          <button
            onClick={onDismiss}
            className={`ml-4 rounded opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 ${styles.focus}`}
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
      <h3 className="text-lg font-medium text-content">{message}</h3>
      {description && (
        <p className="text-sm text-content-subtle mt-2 max-w-md mx-auto">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
