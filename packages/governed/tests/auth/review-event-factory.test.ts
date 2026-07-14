import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asIdempotencyKey,
  asMutationHash,
  asProposalId,
  createReviewEventFactory,
  REVIEW_ACTIONS,
  type AuthenticatedReviewContext,
  type ReviewEventInput,
} from '../../src/index.js';
import { createTestClock } from '../fixtures/clock.js';

function makeInput(overrides: Partial<ReviewEventInput> = {}): ReviewEventInput {
  return {
    proposalId: asProposalId('proposal-1'),
    proposalVersion: 3,
    targetRevision: 7,
    action: 'accept',
    mutationHash: asMutationHash('hash-abc'),
    idempotencyKey: asIdempotencyKey('idem-1'),
    ...overrides,
  };
}

describe('ReviewEventFactory', () => {
  it('derives reviewer identity, channel, and action time only from the authenticated context and clock', () => {
    const clock = createTestClock();
    const factory = createReviewEventFactory({ clock });
    const context: AuthenticatedReviewContext = {
      reviewerId: asActorId('reviewer-1'),
      reviewerDisplayName: 'Steve',
      channel: 'browser',
    };

    const event = factory.create(context, makeInput());

    expect(event.reviewerId).toBe(context.reviewerId);
    expect(event.reviewerDisplayName).toBe('Steve');
    expect(event.channel).toBe('browser');
    expect(event.actionAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('carries through the authoritative proposal facts from input, unmodified', () => {
    const factory = createReviewEventFactory({ clock: createTestClock() });
    const context: AuthenticatedReviewContext = {
      reviewerId: asActorId('reviewer-2'),
      reviewerDisplayName: 'CLI Operator',
      channel: 'cli',
    };
    const input = makeInput({ action: 'revert', targetRevision: null, reviewNote: 'reverting bad merge' });

    const event = factory.create(context, input);

    expect(event.proposalId).toBe(input.proposalId);
    expect(event.proposalVersion).toBe(input.proposalVersion);
    expect(event.targetRevision).toBeNull();
    expect(event.action).toBe('revert');
    expect(event.mutationHash).toBe(input.mutationHash);
    expect(event.idempotencyKey).toBe(input.idempotencyKey);
    expect(event.reviewNote).toBe('reverting bad merge');
  });

  it('advances the clock independently per call, proving time is server-derived and not cached', () => {
    const factory = createReviewEventFactory({ clock: createTestClock() });
    const context: AuthenticatedReviewContext = {
      reviewerId: asActorId('reviewer-1'),
      reviewerDisplayName: 'Steve',
      channel: 'browser',
    };

    const first = factory.create(context, makeInput());
    const second = factory.create(context, makeInput());

    expect(first.actionAt).not.toBe(second.actionAt);
  });

  it('exposes the closed review action set', () => {
    expect(REVIEW_ACTIONS).toEqual(['amend', 'accept', 'reject', 'expire', 'delete', 'revert']);
  });
});
