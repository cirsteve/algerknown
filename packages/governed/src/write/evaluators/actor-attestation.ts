import type { PolicyId } from '../../config/namespace-policy.js';
import type { ActorClass } from '../../domain/provenance.js';
import type { WriteCommand } from '../../domain/write-command.js';
import type { MutationHash } from '../../domain/ids.js';
import type { AttestationVerifier } from '../../ports/attestation-verifier.js';
import type { ProposalRepository } from '../../ports/proposal-repository.js';
import type { EvaluatorVerdict } from '../../domain/provenance.js';
import { makeVerdict } from './verdict.js';

/**
 * 'human' accepts only authenticated human-origin writes; 'human-gated' accepts
 * processor-originated writes but still requires attestation (checked
 * separately); 'ai-with-rails' accepts either, gated by the rail evaluators.
 */
export function evaluateActorClassAllowed(policy: PolicyId, actorClass: ActorClass): EvaluatorVerdict {
  if (policy === 'human' && actorClass !== 'human') {
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
  policy: PolicyId,
  command: WriteCommand,
  mutationHash: MutationHash,
  verifier: AttestationVerifier,
  proposalRepository: ProposalRepository,
): Promise<EvaluatorVerdict> {
  const requiresAttestation = policy === 'human' || policy === 'human-gated';
  if (!requiresAttestation) {
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
