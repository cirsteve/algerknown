import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode, forwardRef } from 'react';

const baseInputStyles = [
  'w-full rounded-lg border border-edge bg-surface-raised text-content transition-colors',
  'placeholder:text-content-subtle',
  'hover:border-edge-strong',
  'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40',
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-muted disabled:hover:border-edge',
].join(' ');
const errorInputStyles =
  'border-red-500 hover:border-red-500 focus:border-red-500 focus:ring-red-500/40 dark:border-red-400 dark:hover:border-red-400 dark:focus:border-red-400';

const sizeStyles = {
  sm: 'px-2 py-1.5 text-sm',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-3 text-base',
};

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: 'sm' | 'md' | 'lg';
  error?: boolean;
}

/**
 * Input atom - Text input field
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(({ 
  inputSize = 'md',
  error = false,
  className = '',
  ...props 
}, ref) => {
  const errorStyles = error ? errorInputStyles : '';
  
  return (
    <input
      ref={ref}
      className={`${baseInputStyles} ${sizeStyles[inputSize]} ${errorStyles} ${className}`}
      {...props}
    />
  );
});

Input.displayName = 'Input';

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  inputSize?: 'sm' | 'md' | 'lg';
  error?: boolean;
}

/**
 * TextArea atom - Multi-line text input
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(({ 
  inputSize = 'md',
  error = false,
  className = '',
  ...props 
}, ref) => {
  const errorStyles = error ? errorInputStyles : '';
  
  return (
    <textarea
      ref={ref}
      className={`${baseInputStyles} ${sizeStyles[inputSize]} ${errorStyles} ${className}`}
      {...props}
    />
  );
});

TextArea.displayName = 'TextArea';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  inputSize?: 'sm' | 'md' | 'lg';
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

/**
 * Select atom - Dropdown select input
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ 
  inputSize = 'md',
  options,
  placeholder,
  className = '',
  ...props 
}, ref) => {
  return (
    <select
      ref={ref}
      className={`${baseInputStyles} ${sizeStyles[inputSize]} ${className}`}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
});

Select.displayName = 'Select';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

/**
 * FormField atom - Label + input wrapper with error/hint support
 */
export function FormField({ label, htmlFor, error, hint, children }: FormFieldProps) {
  return (
    <div className="space-y-1">
      <label 
        htmlFor={htmlFor}
        className="block text-sm font-medium text-content-muted"
      >
        {label}
      </label>
      {children}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {hint && !error && <p className="text-sm text-content-subtle">{hint}</p>}
    </div>
  );
}
