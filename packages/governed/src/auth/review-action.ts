/**
 * Closed set of actions a human reviewer may take against a proposal.
 * Processor credentials are propose-only and never authorize any of these.
 */
export const REVIEW_ACTIONS = ['amend', 'accept', 'reject', 'expire', 'delete', 'revert'] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === 'string' && (REVIEW_ACTIONS as readonly string[]).includes(value);
}
