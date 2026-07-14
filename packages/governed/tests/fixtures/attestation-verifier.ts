import type { Attestation, AttestationVerificationRequest, AttestationVerifier } from '../../src/index.js';

/** Register attestations exactly as a reviewer's approval would produce them; verify never trusts request fields alone. */
export class StubAttestationVerifier implements AttestationVerifier {
  private readonly byId = new Map<string, Attestation>();

  register(attestation: Attestation): void {
    this.byId.set(attestation.id, attestation);
  }

  async verify(request: AttestationVerificationRequest): Promise<Attestation | undefined> {
    const attestation = this.byId.get(request.attestationId);
    if (!attestation) return undefined;
    if (
      attestation.proposalId !== request.expectedProposalId ||
      attestation.proposalVersion !== request.expectedProposalVersion ||
      attestation.mutationHash !== request.expectedMutationHash
    ) {
      return undefined;
    }
    return attestation;
  }
}
