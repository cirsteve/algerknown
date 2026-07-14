import type { PolicyModeCapabilities } from './policy-mode.js';

/** Accepts processor-originated proposals, but only applies once accepted with a matching attestation. */
export const HUMAN_GATED_POLICY_MODE: PolicyModeCapabilities = {
  id: 'human-gated',
  acceptedActorClasses: ['human', 'processor'],
  requiresAttestation: true,
  permitsDirectAiMutation: false,
};
