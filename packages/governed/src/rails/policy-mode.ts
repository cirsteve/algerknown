import type { ActorClass } from '../domain/provenance.js';
import type { BuiltInPolicyId, PolicyId } from '../config/namespace-policy.js';

export interface PolicyModeCapabilities {
  id: PolicyId;
  /** Actor classes that may originate a write accepted by this policy. */
  acceptedActorClasses: ActorClass[];
  /** Whether a verified attestation binding the exact mutation and proposal version is mandatory. */
  requiresAttestation: boolean;
  /** Whether an eligible non-truth mutation may apply directly once every deterministic evaluator passes. */
  permitsDirectAiMutation: boolean;
}

export type PolicyModeRegistry = Record<string, PolicyModeCapabilities>;
