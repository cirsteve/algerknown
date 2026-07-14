import type { PolicyModeCapabilities } from './policy-mode.js';

/** Accepts only authenticated human-origin proposals, gated by a matching attestation. */
export const HUMAN_POLICY_MODE: PolicyModeCapabilities = {
  id: 'human',
  acceptedActorClasses: ['human'],
  requiresAttestation: true,
  permitsDirectAiMutation: false,
};
