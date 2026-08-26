import { Link, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';

interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  badge?: number;
  /** Fired after a successful activation - the drawer uses it to dismiss itself. */
  onClick?: () => void;
  className?: string;
}

const itemBase =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors';

/**
 * NavItem molecule - Navigation link with icon
 *
 * Renders identically in the desktop sidebar and the mobile drawer; the only
 * difference is the `onClick` the drawer passes to dismiss itself.
 */
export function NavItem({
  to,
  icon,
  label,
  disabled = false,
  disabledReason,
  badge,
  onClick,
  className = ''
}: NavItemProps) {
  const location = useLocation();
  const isActive = location.pathname === to;

  if (disabled) {
    return (
      <span
        className={`
          ${itemBase}
          text-content-subtle cursor-not-allowed
          ${className}
        `}
        aria-disabled="true"
        title={disabledReason}
      >
        <span aria-hidden="true" className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </span>
    );
  }

  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={`
        ${itemBase}
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised
        ${isActive
          ? 'bg-accent/15 text-link font-medium'
          : 'text-content-muted hover:bg-surface-hover hover:text-content'
        }
        ${className}
      `}
    >
      <span aria-hidden="true" className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium text-accent-fg">
          {badge}
        </span>
      )}
    </Link>
  );
}

interface NavGroupProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * NavGroup molecule - Group of navigation items with optional title
 */
export function NavGroup({ title, children, className = '' }: NavGroupProps) {
  return (
    <div className={className}>
      {title && (
        <h3 className="mb-2 px-3 text-xs uppercase tracking-wider text-content-subtle">
          {title}
        </h3>
      )}
      <ul className="space-y-1">
        {children}
      </ul>
    </div>
  );
}
