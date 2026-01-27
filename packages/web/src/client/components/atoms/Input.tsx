import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode, forwardRef } from 'react';

const baseInputStyles = 'w-full bg-slate-800 border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-sky-500 transition-colors';
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
  const errorStyles = error ? 'border-red-500 focus:border-red-500' : '';
  
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
  const errorStyles = error ? 'border-red-500 focus:border-red-500' : '';
  
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
        className="block text-sm font-medium text-slate-400"
      >
        {label}
      </label>
      {children}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {hint && !error && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
