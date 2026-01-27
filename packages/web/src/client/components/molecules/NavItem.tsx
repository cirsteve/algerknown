import { Link, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';

interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

/**
 * NavItem molecule - Navigation link with icon
 */
export function NavItem({ 
  to, 
  icon, 
  label, 
  disabled = false,
  disabledReason,
  className = '' 
}: NavItemProps) {
  const location = useLocation();
  const isActive = location.pathname === to;

  if (disabled) {
    return (
      <span
        className={`
          flex items-center gap-3 px-3 py-2 rounded-lg 
          text-slate-500 cursor-not-allowed
          ${className}
        `}
        title={disabledReason}
      >
        <span>{icon}</span>
        <span>{label}</span>
      </span>
    );
  }

  return (
    <Link
      to={to}
      className={`
        flex items-center gap-3 px-3 py-2 rounded-lg transition-colors
        ${isActive
          ? 'bg-sky-500/20 text-sky-300'
          : 'text-slate-300 hover:bg-slate-700'
        }
        ${className}
      `}
    >
      <span>{icon}</span>
      <span>{label}</span>
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
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 px-3">
          {title}
        </h3>
      )}
      <ul className="space-y-1">
        {children}
      </ul>
    </div>
  );
}
