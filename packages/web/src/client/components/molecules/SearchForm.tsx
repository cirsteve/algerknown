import { FormEvent, ReactNode } from 'react';
import { Button } from '../atoms/Button';
import { Input, Select } from '../atoms/Input';

interface SearchFormProps {
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading?: boolean;
  placeholder?: string;
  typeFilter?: string;
  onTypeFilterChange?: (type: string) => void;
  typeOptions?: Array<{ value: string; label: string }>;
  children?: ReactNode;
}

/**
 * SearchForm molecule - A search input with submit button
 * 
 * Combines: Input, Select, Button
 */
export function SearchForm({
  query,
  onQueryChange,
  onSubmit,
  loading = false,
  placeholder = 'Search...',
  typeFilter,
  onTypeFilterChange,
  typeOptions,
  children,
}: SearchFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex gap-4">
        <Input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
          inputSize="lg"
        />
        
        {typeOptions && onTypeFilterChange && (
          <Select
            value={typeFilter || ''}
            onChange={(e) => onTypeFilterChange(e.target.value)}
            options={typeOptions}
            placeholder="All Types"
          />
        )}
        
        <Button
          type="submit"
          loading={loading}
          disabled={loading}
          size="lg"
        >
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </div>
      {children}
    </form>
  );
}

interface QuickSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * QuickSearch molecule - A simpler inline search input
 */
export function QuickSearch({
  value,
  onChange,
  placeholder = 'Search...',
  className = '',
}: QuickSearchProps) {
  return (
    <div className={`relative ${className}`}>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-10"
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        🔍
      </span>
    </div>
  );
}
