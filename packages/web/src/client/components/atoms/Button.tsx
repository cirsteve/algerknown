import { ReactNode, ButtonHTMLAttributes } from 'react';
import { Link, LinkProps } from 'react-router-dom';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

const baseStyles = [
  'inline-flex items-center justify-center font-medium transition-colors rounded-lg',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
].join(' ');

/*
 * Neutral variants ride the semantic control/content tokens so they follow the
 * scheme automatically. Destructive and success fills keep an explicit hue -
 * the shade is chosen so white text clears AA against it in both schemes.
 */
const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent hover:bg-accent-hover active:bg-accent-hover text-accent-fg focus-visible:ring-accent',
  secondary: 'bg-control hover:bg-control-hover active:bg-control-active text-content focus-visible:ring-accent',
  ghost: 'bg-transparent hover:bg-control active:bg-control-hover text-content-muted hover:text-content focus-visible:ring-accent',
  danger: 'bg-red-600 hover:bg-red-700 active:bg-red-800 dark:hover:bg-red-500 dark:active:bg-red-400 text-white focus-visible:ring-red-500',
  success: 'bg-green-700 hover:bg-green-800 active:bg-green-900 dark:hover:bg-green-600 dark:active:bg-green-500 text-white focus-visible:ring-green-600',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'text-sm px-3 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2 gap-2',
  lg: 'text-base px-6 py-3 gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/**
 * Button atom - Primary interactive element
 */
export function Button({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  loading = false,
  disabled,
  className = '',
  ...props 
}: ButtonProps) {
  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * IconButton atom - Button with just an icon
 */
export function IconButton({ 
  icon, 
  label, 
  variant = 'ghost', 
  size = 'md',
  className = '',
  ...props 
}: IconButtonProps) {
  const iconSizeStyles: Record<ButtonSize, string> = {
    sm: 'p-1.5',
    md: 'p-2',
    lg: 'p-3',
  };

  return (
    <button
      aria-label={label}
      title={label}
      className={`${baseStyles} ${variantStyles[variant]} ${iconSizeStyles[size]} ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
}

interface LinkButtonProps extends Omit<LinkProps, 'className'> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/**
 * LinkButton atom - A link styled as a button
 */
export function LinkButton({ 
  children, 
  variant = 'primary', 
  size = 'md',
  className = '',
  ...props 
}: LinkButtonProps) {
  return (
    <Link
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}
