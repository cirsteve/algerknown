import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TypeBadge, StatusBadge } from '../atoms/Badge';
import { Button, LinkButton } from '../atoms/Button';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backLink?: { to: string; label: string };
  actions?: ReactNode;
  className?: string;
}

/**
 * PageHeader organism - Page title section with optional actions
 */
export function PageHeader({ 
  title, 
  subtitle,
  backLink,
  actions,
  className = '' 
}: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between ${className}`}>
      <div>
        {backLink && (
          <Link 
            to={backLink.to} 
            className="text-sky-400 hover:text-sky-300 text-sm inline-flex items-center gap-1"
          >
            ← {backLink.label}
          </Link>
        )}
        <h1 className={`text-2xl font-bold text-slate-100 ${backLink ? 'mt-2' : ''}`}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-slate-400 mt-1 text-sm">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

interface EntryHeaderProps {
  id: string;
  topic?: string;
  type: 'summary' | 'entry' | string;
  status?: string;
  tags?: string[];
  onEdit?: () => void;
  onDelete?: () => void;
  onViewGraph?: () => void;
  className?: string;
}

/**
 * EntryHeader organism - Header for entry detail pages
 */
export function EntryHeader({
  id,
  topic,
  type,
  status,
  tags,
  onEdit,
  onDelete,
  onViewGraph,
  className = '',
}: EntryHeaderProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-start justify-between">
        <div>
          <Link to="/entries" className="text-sky-400 hover:text-sky-300 text-sm">
            ← Back to entries
          </Link>
          <h1 className="text-2xl font-bold text-slate-100 mt-2">
            {topic || id}
          </h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-slate-400">
            <TypeBadge type={type} />
            <span>{id}</span>
            {status && <StatusBadge status={status} />}
          </div>
        </div>
        
        <div className="flex gap-2">
          {onEdit && (
            <LinkButton
              to={`/entries/${id}/edit`}
              variant="secondary"
              size="sm"
              onClick={onEdit}
            >
              Edit
            </LinkButton>
          )}
          {onViewGraph && (
            <LinkButton to={`/graph/${id}`} variant="secondary" size="sm">
              View Graph
            </LinkButton>
          )}
          {onDelete && (
            <Button variant="danger" size="sm" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <span 
              key={tag} 
              className="text-xs px-2 py-1 bg-slate-700 rounded text-slate-300"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
