import type { Attestation, AttestationVerificationRequest, AttestationVerifier } from '@algerknown/governed';

/**
 * Single-operator trust profile: there is no external identity provider to
 * verify a signature against. The composition root itself mints an
 * Attestation from server-authenticated reviewer context immediately before
 * calling into DurableProposalService, registers it here, and the service
 * verifies it matches the exact proposal id/version/mutation hash it expects
 * -- the same self-consistency check the orchestrator would apply against
 * any other AttestationVerifier implementation, just without a remote party.
 */
export interface LocalAttestationVerifier extends AttestationVerifier {
  register(attestation: Attestation): void;
  /** Releases a registered attestation once the review action that needed it has resolved (success or failure). */
  discard(attestationId: string): void;
}

/**
 * verify() is called twice per accept/revert -- once by DurableProposalService
 * itself (to persist the Attestation record) and again by WriteOrchestrator's
 * own attestation-requirement evaluator -- so it must NOT consume the
 * registered attestation on match; the caller discards it explicitly once
 * the action has fully resolved.
 */
export function createLocalAttestationVerifier(): LocalAttestationVerifier {
  const pending = new Map<string, Attestation>();

  return {
    register(attestation: Attestation): void {
      pending.set(attestation.id, attestation);
    },
    discard(attestationId: string): void {
      pending.delete(attestationId);
    },
    async verify(request: AttestationVerificationRequest): Promise<Attestation | undefined> {
      const attestation = pending.get(request.attestationId);
      if (!attestation) return undefined;
      if (attestation.proposalId !== request.expectedProposalId) return undefined;
      if (attestation.proposalVersion !== request.expectedProposalVersion) return undefined;
      if (attestation.mutationHash !== request.expectedMutationHash) return undefined;
      return attestation;
    },
  };
}
