import type { ActorId } from '../domain/ids.js';

/** How the caller authenticated: a browser session cookie, or a CLI bearer secret. */
export type ReviewChannel = 'browser' | 'cli';

/**
 * Server-verified reviewer identity for a single request. Callers never
 * supply these fields directly; they are populated only by an
 * authentication boundary that has already validated a session or secret.
 */
export interface AuthenticatedReviewContext {
  reviewerId: ActorId;
  reviewerDisplayName: string;
  channel: ReviewChannel;
}
