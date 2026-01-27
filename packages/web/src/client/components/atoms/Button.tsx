import { ReactNode, ButtonHTMLAttributes } from 'react';
import { Link, LinkProps } from 'react-router-dom';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

const baseStyles = 'inline-flex items-center justify-center font-medium transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed';

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-sky-500 hover:bg-sky-400 text-white focus:ring-sky-500',
  secondary: 'bg-slate-700 hover:bg-slate-600 text-slate-100 focus:ring-slate-500',
  ghost: 'bg-transparent hover:bg-slate-700 text-slate-300 focus:ring-slate-500',
  danger: 'bg-red-600 hover:bg-red-500 text-white focus:ring-red-500',
  success: 'bg-green-600 hover:bg-green-500 text-white focus:ring-green-500',
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
  const spinnerSize = size === 'lg' ? 'md' : 'sm';
  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner size={spinnerSize} />}
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
