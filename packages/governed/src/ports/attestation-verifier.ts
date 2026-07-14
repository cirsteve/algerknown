import type { AttestationId, MutationHash, ProposalId } from '../domain/ids.js';
import type { Attestation } from '../domain/attestation.js';

export interface AttestationVerificationRequest {
  attestationId: AttestationId;
  expectedProposalId: ProposalId;
  expectedProposalVersion: number;
  expectedMutationHash: MutationHash;
}

/**
 * Returns the canonical Attestation only when it matches the exact proposal
 * version and mutation hash requested; the orchestrator never trusts
 * caller-supplied attestation fields directly.
 */
export interface AttestationVerifier {
  verify(request: AttestationVerificationRequest): Promise<Attestation | undefined>;
}
