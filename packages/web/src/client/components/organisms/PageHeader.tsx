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

/*
 * Side-by-side title and actions need roughly 30rem to look right, so the row
 * only becomes a row at `sm`. Below that the actions stack under the title and
 * wrap among themselves instead of squeezing it off-screen. `min-w-0` plus
 * `break-words` keeps an unbroken id or topic inside the viewport rather than
 * widening the document.
 */
const titleBlock = 'min-w-0 flex-1 break-words';
const actionRow = 'flex flex-wrap gap-2 sm:shrink-0';

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
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`}>
      <div className={titleBlock}>
        {backLink && (
          <Link 
            to={backLink.to} 
            className="inline-flex items-center gap-1 rounded-sm text-sm text-link transition-colors hover:text-link-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ← {backLink.label}
          </Link>
        )}
        <h1 className={`text-xl font-bold text-content-strong sm:text-2xl ${backLink ? 'mt-2' : ''}`}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-content-muted">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className={actionRow}>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className={titleBlock}>
          <Link
            to="/entries"
            className="rounded-sm text-sm text-link transition-colors hover:text-link-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ← Back to entries
          </Link>
          <h1 className="mt-2 text-xl font-bold text-content-strong sm:text-2xl">
            {topic || id}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-content-muted">
            <TypeBadge type={type} />
            <span className="break-all">{id}</span>
            {status && <StatusBadge status={status} />}
          </div>
        </div>
        
        <div className={actionRow}>
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
              className="rounded bg-control px-2 py-1 text-xs text-content"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
