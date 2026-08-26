import { ReactNode } from 'react';
import { PageHeader } from '../organisms/PageHeader';
import { LoadingState } from '../atoms/Spinner';
import { AlertBox } from '../molecules/AlertBox';

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  backLink?: { to: string; label: string };
  actions?: ReactNode;
  loading?: boolean;
  loadingMessage?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

/**
 * PageLayout template - Standard page structure with header
 * 
 * Provides consistent page structure with:
 * - Page header with title, subtitle, back link, and actions
 * - Loading and error states
 * - Main content area
 *
 * `min-w-0` on the column stops a wide child from stretching the page past the
 * viewport; error text gets `break-words` because failures often carry an
 * unbroken URL or path that would otherwise not fit at 320px.
 */
export function PageLayout({
  title,
  subtitle,
  backLink,
  actions,
  loading = false,
  loadingMessage = 'Loading...',
  error,
  children,
  className = '',
}: PageLayoutProps) {
  if (loading) {
    return (
      <div className={`min-w-0 space-y-6 ${className}`}>
        <LoadingState message={loadingMessage} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`min-w-0 space-y-6 ${className}`}>
        <PageHeader 
          title={title}
          subtitle={subtitle}
          backLink={backLink}
          actions={actions}
        />
        <AlertBox variant="error">
          <span className="block break-words">{error}</span>
        </AlertBox>
      </div>
    );
  }

  return (
    <div className={`min-w-0 space-y-6 ${className}`}>
      <PageHeader 
        title={title} 
        subtitle={subtitle}
        backLink={backLink}
        actions={actions}
      />
      {children}
    </div>
  );
}

interface ContentSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * ContentSection template - A titled section within a page
 */
export function ContentSection({ title, children, className = '' }: ContentSectionProps) {
  return (
    <section className={`min-w-0 ${className}`}>
      {title && (
        <h2 className="mb-4 text-lg font-semibold text-content-strong sm:text-xl">{title}</h2>
      )}
      {children}
    </section>
  );
}

interface CardSectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * CardSection template - Content in a card container
 */
export function CardSection({ title, children, className = '' }: CardSectionProps) {
  return (
    <section className={`min-w-0 rounded-lg border border-edge bg-surface-raised p-4 sm:p-6 ${className}`}>
      {title && (
        <h2 className="mb-4 text-base font-semibold text-content-strong sm:text-lg">{title}</h2>
      )}
      {children}
    </section>
  );
}
