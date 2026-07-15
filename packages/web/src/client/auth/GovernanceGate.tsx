import type { ReactNode } from 'react';
import { useGovernanceAuth } from './GovernanceAuthContext';
import { UnlockScreen } from './UnlockScreen';
import { ReviewerBadge } from './ReviewerBadge';

/**
 * Renders the unlock screen while locked, and the app (plus a reviewer
 * badge) once unlocked or when governance isn't configured for this
 * deployment at all.
 */
export function GovernanceGate({ children }: { children: ReactNode }) {
  const { status } = useGovernanceAuth();

  if (status === 'checking') return null;
  if (status === 'locked' || status === 'unlocking') return <UnlockScreen />;

  return (
    <>
      {children}
      <ReviewerBadge />
    </>
  );
}
