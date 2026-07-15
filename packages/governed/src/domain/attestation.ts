import type { ActorId, AttestationId, MutationHash, ProposalId } from './ids.js';

export interface Attestation {
  id: AttestationId;
  reviewerId: ActorId;
  approvedAt: string;
  proposalId: ProposalId;
  proposalVersion: number;
  targetRevision: number | null;
  mutationHash: MutationHash;
  reviewNote?: string;
  channel: string;
  verifierMeta: Record<string, unknown>;
}

export interface AttestationInput {
  attestationId: AttestationId;
}
