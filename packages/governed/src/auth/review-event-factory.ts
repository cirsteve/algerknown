import type { IdempotencyKey, MutationHash, ProposalId } from '../domain/ids.js';
import type { Clock } from '../ports/clock.js';
import type { AuthenticatedReviewContext } from './authenticated-review-context.js';
import type { ReviewAction } from './review-action.js';

/**
 * Caller-supplied facts about the review action, deliberately excluding any
 * identity, channel, or timestamp field: those come only from
 * AuthenticatedReviewContext and the server Clock.
 */
export interface ReviewEventInput {
  proposalId: ProposalId;
  proposalVersion: number;
  targetRevision: number | null;
  action: ReviewAction;
  mutationHash: MutationHash;
  idempotencyKey: IdempotencyKey;
  reviewNote?: string;
}

export interface ReviewEvent {
  reviewerId: AuthenticatedReviewContext['reviewerId'];
  reviewerDisplayName: string;
  channel: AuthenticatedReviewContext['channel'];
  actionAt: string;
  proposalId: ProposalId;
  proposalVersion: number;
  targetRevision: number | null;
  action: ReviewAction;
  mutationHash: MutationHash;
  idempotencyKey: IdempotencyKey;
  reviewNote?: string;
}

export interface ReviewEventFactory {
  create(context: AuthenticatedReviewContext, input: ReviewEventInput): ReviewEvent;
}

export interface ReviewEventFactoryDeps {
  clock: Clock;
}

/**
 * The single trusted boundary for constructing a review event. Identity and
 * action time always come from `context`/`clock`, never from `input`, so no
 * downstream caller can forge an accepted review event from request fields.
 */
export function createReviewEventFactory(deps: ReviewEventFactoryDeps): ReviewEventFactory {
  return {
    create(context, input) {
      return {
        reviewerId: context.reviewerId,
        reviewerDisplayName: context.reviewerDisplayName,
        channel: context.channel,
        actionAt: deps.clock.now(),
        proposalId: input.proposalId,
        proposalVersion: input.proposalVersion,
        targetRevision: input.targetRevision,
        action: input.action,
        mutationHash: input.mutationHash,
        idempotencyKey: input.idempotencyKey,
        reviewNote: input.reviewNote,
      };
    },
  };
}
