import type { ActorClass } from '../../domain/provenance.js';
import type { WriteCommand } from '../../domain/write-command.js';
import type { MutationHash } from '../../domain/ids.js';
import type { AttestationVerifier } from '../../ports/attestation-verifier.js';
import type { ProposalRepository } from '../../ports/proposal-repository.js';
import type { EvaluatorVerdict } from '../../domain/provenance.js';
import type { PolicyModeCapabilities } from '../../rails/policy-mode.js';
import { makeVerdict } from './verdict.js';

/**
 * Each policy mode declares which actor classes it accepts; 'human' accepts
 * only authenticated human-origin writes, while 'human-gated' and
 * 'ai-with-rails' also accept processor-originated writes (gated by
 * attestation or by the rail evaluators, respectively).
 */
export function evaluateActorClassAllowed(mode: PolicyModeCapabilities, actorClass: ActorClass): EvaluatorVerdict {
  if (!mode.acceptedActorClasses.includes(actorClass)) {
    return makeVerdict('actor-attestation', false, ['ACTOR_CLASS_NOT_PERMITTED_BY_POLICY']);
  }
  return makeVerdict('actor-attestation', true);
}

/**
 * 'human' and 'human-gated' writes require an attestation accepted by the
 * AttestationVerifier port that matches the exact normalized mutation
 * (mutationHash) and proposal version -- presence alone is never sufficient.
 */
export async function evaluateAttestationRequirement(
  mode: PolicyModeCapabilities,
  command: WriteCommand,
  mutationHash: MutationHash,
  verifier: AttestationVerifier,
  proposalRepository: ProposalRepository,
): Promise<EvaluatorVerdict> {
  if (!mode.requiresAttestation) {
    return makeVerdict('actor-attestation', true);
  }

  if (!command.attestation) {
    return makeVerdict('actor-attestation', false, ['ATTESTATION_REQUIRED']);
  }

  const proposal = await proposalRepository.findPendingByMutationHash(command.namespace, mutationHash);
  if (!proposal) {
    return makeVerdict('actor-attestation', false, ['ATTESTATION_NOT_FOUND']);
  }

  const attestation = await verifier.verify({
    attestationId: command.attestation.attestationId,
    expectedProposalId: proposal.id,
    expectedProposalVersion: proposal.version,
    expectedMutationHash: mutationHash,
  });

  if (!attestation) {
    return makeVerdict('actor-attestation', false, ['ATTESTATION_NOT_FOUND']);
  }
  if (attestation.mutationHash !== mutationHash) {
    return makeVerdict('actor-attestation', false, ['ATTESTATION_MUTATION_MISMATCH']);
  }
  if (attestation.proposalVersion !== proposal.version) {
    return makeVerdict('actor-attestation', false, ['ATTESTATION_VERSION_MISMATCH']);
  }

  return makeVerdict('actor-attestation', true);
}
