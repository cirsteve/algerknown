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
      <div className={`space-y-6 ${className}`}>
        <LoadingState message={loadingMessage} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`space-y-6 ${className}`}>
        <PageHeader 
          title={title}
          subtitle={subtitle}
          backLink={backLink}
          actions={actions}
        />
        <AlertBox variant="error">{error}</AlertBox>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
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
    <section className={className}>
      {title && (
        <h2 className="text-xl font-semibold text-slate-200 mb-4">{title}</h2>
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
    <section className={`bg-slate-800 rounded-lg p-6 ${className}`}>
      {title && (
        <h2 className="text-lg font-semibold text-slate-200 mb-4">{title}</h2>
      )}
      {children}
    </section>
  );
}
