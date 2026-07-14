import type {
  ActorId,
  AttestationId,
  EventId,
  MutationHash,
  NamespaceId,
  NodeId,
  ProcessorId,
  ProposalId,
  SubjectId,
} from '../domain/ids.js';
import type { ActorClass, Provenance } from '../domain/provenance.js';
import type { WriteCommand } from '../domain/write-command.js';

/**
 * The durable lifecycle recognizes five states -- unlike the settled
 * ProposalRepository port's four-state ProposalStatus, which SqliteProposalRepository
 * maps to/from as a documented compatibility shim (see proposal-repository.ts).
 */
export type DurableProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'deleted';

export interface DurableProposal {
  id: ProposalId;
  targetNamespace: NamespaceId;
  targetSubject: SubjectId;
  status: DurableProposalStatus;
  version: number;
  mutationHash: MutationHash;
  fingerprint: string;
  expectedTargetRevision: number | null;
  createdAt: string;
  updatedAt: string;
  resultingRevision: number | null;
  reverted: boolean;
}

export interface DurableProposalVersion {
  versionId: string;
  proposalId: ProposalId;
  version: number;
  canonicalMutation: WriteCommand;
  mutationHash: MutationHash;
  expectedTargetRevision: number | null;
  supportingObservationIds: NodeId[];
  provenance: Provenance;
  createdAt: string;
}

export interface DurableProposalEvent {
  eventId: EventId;
  proposalId: ProposalId;
  kind: string;
  at: string;
  actorId?: ActorId;
  proposalVersion?: number;
  reason?: string;
  note?: string;
  channel?: string;
  reviewBatchId?: string;
  detail?: Record<string, unknown>;
}

export interface ProposalInspection {
  proposal: DurableProposal;
  currentVersion: DurableProposalVersion;
  events: DurableProposalEvent[];
}

export interface ProposeInput {
  mutation: WriteCommand;
  supportingObservationIds: NodeId[];
  idempotencyKey: string;
}

export type ProposeOutcome =
  | { outcome: 'created'; proposal: DurableProposal }
  | { outcome: 'suppressed'; priorProposalId: ProposalId; reason: string | undefined };

export interface AmendInput {
  expectedVersion: number;
  mutation: WriteCommand;
  supportingObservationIds: NodeId[];
  idempotencyKey: string;
}

export interface AcceptInput {
  expectedVersion: number;
  expectedTargetRevision: number | null;
  attestationId: AttestationId;
  actorId: ActorId;
  channel: string;
  reviewNote?: string;
  reviewBatchId?: string;
  idempotencyKey: string;
}

export type AcceptOutcome =
  | { outcome: 'accepted'; resultingRevision: number }
  | { outcome: 'version_conflict'; expectedVersion: number; actualVersion: number }
  | { outcome: 'target_revision_conflict'; expectedRevision: number | null; actualRevision: number };

export interface RejectInput {
  expectedVersion: number;
  actorId: ActorId;
  reason: string;
  channel?: string;
  idempotencyKey: string;
}

export interface ExpireInput {
  expectedVersion: number;
  note: string;
  actorId?: ActorId;
  idempotencyKey: string;
}

export interface DeleteInput {
  expectedVersion: number;
  actorId: ActorId;
  reason: string;
  idempotencyKey: string;
}

/**
 * Result of proposeRevert(): the inverse mutation for an accepted proposal's
 * resulting revision, saved as its own pending port-level proposal so a
 * policy that requires attestation (human/human-gated) has something to
 * verify an attestation against before revert() applies it -- the same
 * two-phase shape as propose()+accept(), just for the inverse mutation.
 */
export interface ProposeRevertOutcome {
  revertProposalId: ProposalId;
  revertProposalVersion: number;
  mutationHash: MutationHash;
}

export interface RevertInput {
  actorId: ActorId;
  actorClass: ActorClass;
  reason: string;
  channel?: string;
  idempotencyKey: string;
  /**
   * Required when the target namespace's policy requires attestation: the id
   * of a prior proposeRevert() call's candidate, plus an attestation bound to
   * that exact candidate id/version/mutationHash. Omit both for a namespace
   * that permits direct mutation (e.g. ai-with-rails), where revert applies
   * in one call with no attestation cycle.
   */
  revertCandidateId?: ProposalId;
  attestationId?: AttestationId;
}

export type RevertOutcome =
  | { outcome: 'reverted'; newRevision: number }
  | { outcome: 'target_revision_conflict'; expectedRevision: number | null; actualRevision: number };

export interface ReviewMeasurementsQuery {
  namespace?: NamespaceId;
  from: string;
  to: string;
}

export interface ReviewMeasurements {
  namespace: NamespaceId | null;
  from: string;
  to: string;
  countsByStatus: Record<DurableProposalStatus, number>;
  acceptedCount: number;
  rejectedCount: number;
  acceptanceRate: number | null;
  firstReviewLatencyMsAvg: number | null;
  reviewDurationMsAvg: number | null;
  batchSizes: Record<string, number>;
  batchCadenceMsAvg: number | null;
  reviewerMinutes: Record<string, number>;
}

export interface AuditSample {
  sampleId: string;
  namespace: NamespaceId;
  namespaceRevision: number;
  processorId: ProcessorId | undefined;
  sampledAt: string;
  reviewed: boolean;
  reviewerId?: ActorId;
  verdict?: string;
  note?: string;
  reviewedAt?: string;
}

export interface MarkAuditSampleReviewedInput {
  reviewerId: ActorId;
  verdict: string;
  note?: string;
  at: string;
}
