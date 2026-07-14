import type {
  AcceptInput,
  AcceptOutcome,
  AmendInput,
  AuthenticatedReviewContext,
  Clock,
  DatabaseType,
  DeleteInput,
  DurableProposal,
  DurableProposalService,
  ExpireInput,
  IdGenerator,
  NamespaceMatcher,
  ProposalId,
  RejectInput,
  RevertInput,
  RevertOutcome,
  ReviewEventFactory,
  WriteCommand,
} from '@algerknown/governed';
import { ProposalNotFoundError, asIdempotencyKey, asMutationHash, resolvePolicyMode } from '@algerknown/governed';
import type { LocalAttestationVerifier } from './attestation-verifier.js';
import { blockIntent, completeIntent, createIntent, findActiveIntent } from './git-operation-intents.js';

export class ActiveGitOperationError extends Error {
  constructor(proposalId: ProposalId) {
    super(`proposal "${proposalId}" has an in-flight git operation; wait for it to resolve before reviewing it again`);
    this.name = 'ActiveGitOperationError';
  }
}

export interface ReviewActionsDeps {
  db: DatabaseType;
  proposalService: DurableProposalService;
  attestationVerifier: LocalAttestationVerifier;
  reviewEventFactory: ReviewEventFactory;
  idGenerator: IdGenerator;
  clock: Clock;
  namespaceMatcher: NamespaceMatcher;
  gitRepositoriesByNamespace: Map<string, unknown>;
}

function isGitBacked(deps: ReviewActionsDeps, namespace: string): boolean {
  return deps.gitRepositoriesByNamespace.has(namespace);
}

function assertNoActiveIntent(deps: ReviewActionsDeps, proposalId: ProposalId): void {
  if (findActiveIntent(deps.db, proposalId)) {
    throw new ActiveGitOperationError(proposalId);
  }
}

export interface AcceptActionInput {
  reviewContext: AuthenticatedReviewContext;
  expectedVersion: number;
  expectedTargetRevision: number | null;
  reviewNote?: string;
  reviewBatchId?: string;
  idempotencyKey: string;
}

export async function acceptProposal(deps: ReviewActionsDeps, proposalId: ProposalId, input: AcceptActionInput): Promise<AcceptOutcome> {
  assertNoActiveIntent(deps, proposalId);

  const proposal = await deps.proposalService.getProposal(proposalId);
  if (!proposal) throw new ProposalNotFoundError(proposalId);

  // If input.expectedVersion no longer exists (already superseded by an
  // amendment), accept() itself will detect the version mismatch and return
  // a clean 'version_conflict' outcome before ever consulting the
  // attestation below -- so placeholders here are safe.
  let mutationHash = asMutationHash('stale-version-placeholder');
  let commandIdempotencyKey = 'stale-version-placeholder';
  try {
    const inspection = await deps.proposalService.inspect(proposalId, input.expectedVersion);
    mutationHash = inspection.currentVersion.mutationHash;
    commandIdempotencyKey = String((inspection.currentVersion.canonicalMutation as WriteCommand).idempotencyKey);
  } catch {
    // fall through with the placeholders; accept() will short-circuit on the version mismatch.
  }

  const attestationId = deps.idGenerator.nextAttestationId();
  const event = deps.reviewEventFactory.create(input.reviewContext, {
    proposalId,
    proposalVersion: input.expectedVersion,
    targetRevision: input.expectedTargetRevision,
    action: 'accept',
    mutationHash,
    idempotencyKey: asIdempotencyKey(input.idempotencyKey),
    reviewNote: input.reviewNote,
  });

  deps.attestationVerifier.register({
    id: attestationId,
    reviewerId: event.reviewerId,
    approvedAt: event.actionAt,
    proposalId,
    proposalVersion: input.expectedVersion,
    targetRevision: input.expectedTargetRevision,
    mutationHash,
    reviewNote: input.reviewNote,
    channel: event.channel,
    verifierMeta: {},
  });

  const acceptInput: AcceptInput = {
    expectedVersion: input.expectedVersion,
    expectedTargetRevision: input.expectedTargetRevision,
    attestationId,
    actorId: event.reviewerId,
    channel: event.channel,
    reviewNote: input.reviewNote,
    reviewBatchId: input.reviewBatchId,
    idempotencyKey: input.idempotencyKey,
  };

  const namespace = String(proposal.targetNamespace);
  try {
    if (!isGitBacked(deps, namespace)) {
      return await deps.proposalService.accept(proposalId, acceptInput);
    }

    const operationId = deps.idGenerator.nextOperationId();
    createIntent(deps.db, {
      operationId,
      proposalId,
      action: 'accept',
      namespace,
      commandIdempotencyKey,
      expectedMutationHash: String(mutationHash),
      reviewInput: acceptInput,
      createdAt: deps.clock.now(),
    });

    try {
      const outcome = await deps.proposalService.accept(proposalId, acceptInput);
      completeIntent(deps.db, operationId, outcome.outcome === 'accepted' ? outcome.resultingRevision : null, deps.clock.now());
      return outcome;
    } catch (err) {
      blockIntent(deps.db, operationId, `accept threw: ${(err as Error).message}`, deps.clock.now());
      throw err;
    }
  } finally {
    deps.attestationVerifier.discard(attestationId);
  }
}

export interface RevertActionInput {
  reviewContext: AuthenticatedReviewContext;
  reason: string;
  idempotencyKey: string;
}

export async function revertProposal(deps: ReviewActionsDeps, proposalId: ProposalId, input: RevertActionInput): Promise<RevertOutcome> {
  assertNoActiveIntent(deps, proposalId);

  const proposal = await deps.proposalService.getProposal(proposalId);
  if (!proposal) throw new ProposalNotFoundError(proposalId);

  const namespace = String(proposal.targetNamespace);
  const policyEntry = deps.namespaceMatcher.resolve(proposal.targetNamespace);
  const policyMode = resolvePolicyMode(policyEntry.policy);

  let revertInput: RevertInput;
  let revertAttestationId: string | undefined;

  if (policyMode.requiresAttestation) {
    const candidate = await deps.proposalService.proposeRevert(proposalId, {
      actorId: deps.reviewEventFactory.create(input.reviewContext, {
        proposalId,
        proposalVersion: proposal.version,
        targetRevision: proposal.resultingRevision,
        action: 'revert',
        mutationHash: proposal.mutationHash,
        idempotencyKey: asIdempotencyKey(`${input.idempotencyKey}:proposeRevert`),
      }).reviewerId,
      actorClass: 'human',
      idempotencyKey: `${input.idempotencyKey}:proposeRevert`,
    });

    const attestationId = deps.idGenerator.nextAttestationId();
    const event = deps.reviewEventFactory.create(input.reviewContext, {
      proposalId: candidate.revertProposalId,
      proposalVersion: candidate.revertProposalVersion,
      targetRevision: null,
      action: 'revert',
      mutationHash: candidate.mutationHash,
      idempotencyKey: asIdempotencyKey(input.idempotencyKey),
      reviewNote: input.reason,
    });
    deps.attestationVerifier.register({
      id: attestationId,
      reviewerId: event.reviewerId,
      approvedAt: event.actionAt,
      proposalId: candidate.revertProposalId,
      proposalVersion: candidate.revertProposalVersion,
      targetRevision: null,
      mutationHash: candidate.mutationHash,
      reviewNote: input.reason,
      channel: event.channel,
      verifierMeta: {},
    });

    revertInput = {
      actorId: event.reviewerId,
      actorClass: 'human',
      reason: input.reason,
      channel: event.channel,
      idempotencyKey: input.idempotencyKey,
      revertCandidateId: candidate.revertProposalId,
      attestationId,
    };
    revertAttestationId = attestationId;
  } else {
    const event = deps.reviewEventFactory.create(input.reviewContext, {
      proposalId,
      proposalVersion: proposal.version,
      targetRevision: proposal.resultingRevision,
      action: 'revert',
      mutationHash: proposal.mutationHash,
      idempotencyKey: asIdempotencyKey(input.idempotencyKey),
      reviewNote: input.reason,
    });
    revertInput = {
      actorId: event.reviewerId,
      actorClass: 'human',
      reason: input.reason,
      channel: event.channel,
      idempotencyKey: input.idempotencyKey,
    };
  }

  try {
    if (!isGitBacked(deps, namespace)) {
      return await deps.proposalService.revert(proposalId, revertInput);
    }

    const operationId = deps.idGenerator.nextOperationId();
    createIntent(deps.db, {
      operationId,
      proposalId,
      action: 'revert',
      namespace,
      commandIdempotencyKey: input.idempotencyKey,
      expectedMutationHash: String(proposal.mutationHash),
      reviewInput: revertInput,
      createdAt: deps.clock.now(),
    });

    try {
      const outcome = await deps.proposalService.revert(proposalId, revertInput);
      completeIntent(deps.db, operationId, outcome.outcome === 'reverted' ? outcome.newRevision : null, deps.clock.now());
      return outcome;
    } catch (err) {
      blockIntent(deps.db, operationId, `revert threw: ${(err as Error).message}`, deps.clock.now());
      throw err;
    }
  } finally {
    if (revertAttestationId) deps.attestationVerifier.discard(revertAttestationId);
  }
}

export interface AmendActionInput {
  reviewContext: AuthenticatedReviewContext;
  input: AmendInput;
}

export async function amendProposal(deps: ReviewActionsDeps, proposalId: ProposalId, action: AmendActionInput): Promise<DurableProposal> {
  assertNoActiveIntent(deps, proposalId);
  return deps.proposalService.amend(proposalId, action.input);
}

export async function rejectProposal(deps: ReviewActionsDeps, proposalId: ProposalId, input: RejectInput): Promise<DurableProposal> {
  assertNoActiveIntent(deps, proposalId);
  return deps.proposalService.reject(proposalId, input);
}

export async function expireProposal(deps: ReviewActionsDeps, proposalId: ProposalId, input: ExpireInput): Promise<DurableProposal> {
  assertNoActiveIntent(deps, proposalId);
  return deps.proposalService.expire(proposalId, input);
}

export async function deleteProposal(deps: ReviewActionsDeps, proposalId: ProposalId, input: DeleteInput): Promise<DurableProposal> {
  assertNoActiveIntent(deps, proposalId);
  return deps.proposalService.delete(proposalId, input);
}
