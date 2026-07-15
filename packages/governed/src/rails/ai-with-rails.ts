import type { PolicyModeCapabilities } from './policy-mode.js';

/** Permits an eligible non-truth mutation to apply directly once every deterministic evaluator passes. */
export const AI_WITH_RAILS_POLICY_MODE: PolicyModeCapabilities = {
  id: 'ai-with-rails',
  acceptedActorClasses: ['human', 'processor'],
  requiresAttestation: false,
  permitsDirectAiMutation: true,
};
